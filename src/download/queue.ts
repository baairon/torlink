import { EventEmitter } from "node:events";
import { TorrentEngine, type AddHandlers } from "./engine";
import {
  saveQueue,
  saveQueueSync,
  saveSeeds,
  saveSeedsSync,
  saveTorrentMeta,
  torrentMetaPath,
  torrentMetaExists,
  exportTorrentMeta,
  deleteTorrentMeta,
  type SeedRecord,
} from "./persist";
import { saveHistory, saveHistorySync, type HistoryItem } from "./history";
import type { QueueItem, SeedItem } from "./types";
import type { SourceId } from "../sources/types";

/**
 * A real seed never pulls data off the network: verifying on-disk files reads
 * the disk (network speed stays 0), only fetching *missing* data raises it. So
 * sustained network download on a "seed" means its files are gone or partial.
 * Size-agnostic (a 50 GB verify never trips it) and cross-platform (webtorrent
 * owns the real on-disk paths, so we never guess sanitized filenames).
 */
export function strayDownload(s: { total: number; progress: number; speed: number }): boolean {
  return s.total > 0 && s.progress < 1 && s.speed > 0;
}

const STRAY_TICKS = 2; // consecutive stray polls before flagging missing (~1s)

// How long (ms) to let webtorrent verify on-disk pieces before the stray-download
// detector starts watching. Verification reads the disk and can briefly report
// downloadSpeed > 0 / progress < 1, which is indistinguishable from a truly
// missing file. 10 s covers most single-torrent verifications comfortably.
const SEED_GRACE_MS = 10_000;

const POLL_MS = 500;
const HISTORY_MAX = 500;

// Max torrents allowed to actively download at once. Overflow waits as "queued"
// and starts automatically when a slot frees. 0 / unset = unlimited (default).
function readMaxDownloads(): number {
  const v = Number(process.env.TORLINK_MAX_DOWNLOADS);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export interface AddInput {
  id: string;
  name: string;
  magnet: string;
  source?: SourceId;
  sizeBytes?: number;
}

export class DownloadQueue extends EventEmitter {
  private items = new Map<string, QueueItem>();
  private engine = new TorrentEngine();
  private poll: ReturnType<typeof setInterval> | null = null;
  private history: HistoryItem[] = [];
  private seeds = new Map<string, SeedItem>();
  private strayHits = new Map<string, number>();
  private seedStartedAt = new Map<string, number>();
  private trackers: string[] = [];

  // Max torrents allowed to download at once; overflow waits as "queued".
  private readonly maxDownloads: number;

  constructor(opts?: { maxDownloads?: number }) {
    super();
    this.maxDownloads = opts?.maxDownloads ?? readMaxDownloads();
  }

  // Extra announce URLs appended to every torrent added from now on.
  // Existing running torrents aren't retro-updated — the change takes effect
  // for the next add / resume / re-seed.
  setTrackers(trackers: string[]): void {
    this.trackers = trackers;
  }

  getItems(): QueueItem[] {
    return [...this.items.values()].sort((a, b) => b.addedAt - a.addedAt);
  }

  get activeCount(): number {
    let n = 0;
    for (const it of this.items.values()) if (it.status === "downloading") n++;
    return n;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  add(input: AddInput, dir: string): void {
    if (this.seeds.has(input.id)) {
      this.engine.remove(input.id);
      this.seeds.delete(input.id);
      this.strayHits.delete(input.id);
      this.seedStartedAt.delete(input.id);
      void this.persistSeeds();
    }
    const existing = this.items.get(input.id);
    if (existing && existing.status !== "failed") return;
    const item: QueueItem = existing
      ? {
          ...existing,
          // A re-add is a fresh request, so it targets the dir asked for now.
          // Partial data doesn't follow to a new folder, so resume progress
          // only survives when the dir is unchanged.
          dir,
          status: "downloading",
          error: undefined,
          speed: 0,
          ...(existing.dir === dir
            ? {}
            : { progress: 0, downloadedBytes: 0, eta: undefined }),
        }
      : {
          id: input.id,
          name: input.name,
          source: input.source,
          magnet: input.magnet,
          dir,
          status: "downloading",
          progress: 0,
          totalBytes: input.sizeBytes ?? 0,
          downloadedBytes: 0,
          speed: 0,
          peers: 0,
          addedAt: Date.now(),
        };
    // Respect the concurrent-download cap: start now if a slot is free, else
    // hold the torrent as "queued" until one frees (see promote()).
    const start = this.maxDownloads === 0 || this.activeCount < this.maxDownloads;
    item.status = start ? "downloading" : "queued";
    this.items.set(item.id, item);
    if (start) {
      this.startEngine(item);
      this.ensurePoll();
    }
    this.changed();
    void this.persist();
  }

  private startEngine(item: QueueItem): void {
    this.engine.add(item.id, item.magnet, item.dir, this.engineHandlers(item.id), this.trackers);
  }

  /**
   * Start queued torrents (oldest first) while download slots are free. Called
   * whenever a slot opens up — a download finishes, fails, is paused, or is
   * cancelled. No-op when unlimited (this.maxDownloads === 0), since nothing queues.
   */
  private promote(): void {
    if (this.maxDownloads === 0) return;
    let started = false;
    while (this.activeCount < this.maxDownloads) {
      const next = [...this.items.values()]
        .filter((it) => it.status === "queued")
        .sort((a, b) => a.addedAt - b.addedAt)[0];
      if (!next) break;
      next.status = "downloading";
      next.speed = 0;
      this.startEngine(next);
      started = true;
    }
    if (started) {
      this.ensurePoll();
      this.changed();
      void this.persist();
    }
  }

  // One torrent serves an item across its whole life (download -> seed ->
  // missing), so the engine handlers are phase-aware: they look up the id in
  // `items` (still downloading) or `seeds` (finished, now seeding) and act on
  // whichever it currently is.
  private engineHandlers(id: string): AddHandlers {
    return {
      onMetadata: (meta) => {
        // Capture the .torrent metadata as soon as it arrives so a later re-seed
        // can verify the on-disk file locally (a bare magnet would have to
        // re-fetch this from the swarm, which fails for rare/dead torrents).
        if (meta.torrentFile) void saveTorrentMeta(id, meta.torrentFile);
        const it = this.items.get(id);
        if (!it) return; // the rest only matters while still downloading
        if (meta.name) it.name = meta.name;
        if (meta.total) it.totalBytes = meta.total;
        it.files = meta.files;
        this.changed();
        void this.persist();
      },
      onDone: () => {
        const it = this.items.get(id);
        if (it) {
          // Download finished: record it and keep the torrent seeding.
          if (it.totalBytes) it.downloadedBytes = it.totalBytes;
          this.complete(it);
          return;
        }
        // A re-seed (restart / manual resume) passed verification: the file is
        // confirmed on disk, so clear stray-detection state and end its grace.
        if (this.seeds.has(id)) {
          this.strayHits.set(id, 0);
          this.seedStartedAt.delete(id);
        }
      },
      onError: (msg) => {
        const it = this.items.get(id);
        if (it) {
          it.status = "failed";
          it.error = msg;
          it.speed = 0;
          it.peers = 0;
          this.changed();
          void this.persist();
          this.promote(); // a slot just freed
          this.maybeStopPoll();
          return;
        }
        const sd = this.seeds.get(id);
        if (sd) {
          sd.status = "missing";
          sd.uploadSpeed = 0;
          sd.peers = 0;
          this.seedStartedAt.delete(id);
          this.changed();
          void this.persistSeeds();
          this.maybeStopPoll();
        }
      },
    };
  }

  private complete(it: QueueItem): void {
    this.recordHistory(it);
    this.items.delete(it.id);
    // Opt-out seeding: a finished download is already a complete, verified
    // torrent, so keep it alive and seeding instead of tearing it down.
    this.beginSeed(it);
    this.emit("completed", it.name);
    this.changed();
    void this.persist();
    this.promote(); // a slot just freed
    this.maybeStopPoll();
  }

  // Adopt the just-finished download's live torrent as a seed in place: no
  // re-add, no re-verify (progress is already 1, so stray detection never
  // trips). Restart / manual resume go through startSeeding instead.
  private beginSeed(it: QueueItem): void {
    if (!it.magnet) return;
    this.seeds.set(it.id, {
      id: it.id,
      name: it.name,
      source: it.source,
      magnet: it.magnet,
      dir: it.dir,
      sizeBytes: it.totalBytes,
      status: "seeding",
      uploadSpeed: 0,
      uploaded: 0,
      peers: 0,
    });
    this.strayHits.set(it.id, 0);
    this.seedStartedAt.set(it.id, Date.now());
    this.ensurePoll();
    void this.persistSeeds();
  }

  private tick(): void {
    let any = false;
    for (const it of this.items.values()) {
      if (it.status !== "downloading") continue;
      const s = this.engine.stats(it.id);
      if (!s) continue;
      it.progress = Math.min(100, Math.round(s.progress * 100));
      it.downloadedBytes = s.downloaded;
      if (s.total) it.totalBytes = s.total;
      it.speed = s.speed;
      it.peers = s.peers;
      it.eta =
        s.timeRemaining > 0 && Number.isFinite(s.timeRemaining)
          ? s.timeRemaining / 1000
          : undefined;
      if (s.name) it.name = s.name;
      any = true;
    }
    const now = Date.now();
    for (const sd of this.seeds.values()) {
      if (sd.status !== "seeding") continue;
      const s = this.engine.stats(sd.id);
      if (!s) continue;
      // Safety-net: a seed that's pulling data has lost its files on disk. Give
      // it a couple of ticks (ignore a one-piece repair blip), then stop it and
      // flag missing, never re-download the whole thing.
      //
      // Skip seeds still inside the grace period: webtorrent needs time to
      // hash-verify on-disk pieces, and during that window progress < 1 with
      // downloadSpeed > 0 is perfectly normal.
      const age = now - (this.seedStartedAt.get(sd.id) ?? 0);
      if (age > SEED_GRACE_MS && strayDownload(s)) {
        const hits = (this.strayHits.get(sd.id) ?? 0) + 1;
        this.strayHits.set(sd.id, hits);
        if (hits >= STRAY_TICKS) {
          this.engine.remove(sd.id);
          this.strayHits.delete(sd.id);
          this.seedStartedAt.delete(sd.id);
          sd.status = "missing";
          sd.uploadSpeed = 0;
          sd.peers = 0;
          void this.persistSeeds();
        }
        any = true;
        continue;
      }
      this.strayHits.set(sd.id, 0);
      sd.uploadSpeed = s.uploadSpeed;
      sd.uploaded = s.uploaded;
      sd.peers = s.peers;
      any = true;
    }
    if (any) this.changed();
  }

  private ensurePoll(): void {
    if (this.poll) return;
    this.poll = setInterval(() => this.tick(), POLL_MS);
    this.poll.unref();
  }

  private maybeStopPoll(): void {
    if (this.activeCount === 0 && this.seedingCount === 0 && this.poll) {
      clearInterval(this.poll);
      this.poll = null;
    }
  }

  pause(id: string): void {
    const it = this.items.get(id);
    // A queued (not-yet-started) item can be paused too; only a downloading one
    // holds a live engine + frees a slot on pause.
    if (!it || (it.status !== "downloading" && it.status !== "queued")) return;
    const wasDownloading = it.status === "downloading";
    it.status = "paused";
    it.speed = 0;
    it.peers = 0;
    it.eta = undefined;
    if (wasDownloading) this.engine.remove(id);
    this.changed();
    void this.persist();
    if (wasDownloading) {
      this.promote(); // a slot just freed
      this.maybeStopPoll();
    }
  }

  resume(id: string): void {
    const it = this.items.get(id);
    if (!it || it.status !== "paused") return;
    // Respect the cap on manual resume: start if a slot is free, else re-queue.
    const start = this.maxDownloads === 0 || this.activeCount < this.maxDownloads;
    it.status = start ? "downloading" : "queued";
    if (start) {
      this.startEngine(it);
      this.ensurePoll();
    }
    this.changed();
    void this.persist();
  }

  togglePause(id: string): void {
    const it = this.items.get(id);
    if (!it) return;
    if (it.status === "downloading" || it.status === "queued") this.pause(id);
    else if (it.status === "paused") this.resume(id);
  }

  exportTorrentFile(id: string): Promise<string | null> {
    const it = this.items.get(id) ?? this.seeds.get(id) ?? this.history.find((h) => h.id === id);
    if (!it) return Promise.resolve(null);
    return exportTorrentMeta(it.id, it.name, it.dir);
  }

  cancel(id: string): void {
    if (!this.items.has(id)) return;
    this.engine.remove(id);
    this.items.delete(id);
    deleteTorrentMeta(id);
    this.changed();
    void this.persist();
    this.promote(); // a slot may have freed
    this.maybeStopPoll();
  }

  retry(id: string): void {
    const it = this.items.get(id);
    if (!it || it.status !== "failed") return;
    it.error = undefined;
    // Respect the cap on retry: start if a slot is free, else queue.
    const start = this.maxDownloads === 0 || this.activeCount < this.maxDownloads;
    it.status = start ? "downloading" : "queued";
    if (start) {
      this.startEngine(it);
      this.ensurePoll();
    }
    this.changed();
    void this.persist();
  }

  retryFailed(): void {
    for (const it of [...this.items.values()]) {
      if (it.status === "failed") this.retry(it.id);
    }
  }

  getSeed(id: string): SeedItem | undefined {
    return this.seeds.get(id);
  }

  getSeeds(): SeedItem[] {
    return [...this.seeds.values()];
  }

  get seedingCount(): number {
    let n = 0;
    for (const s of this.seeds.values()) if (s.status === "seeding") n++;
    return n;
  }

  startSeeding(h: HistoryItem): void {
    if (this.seeds.get(h.id)?.status === "seeding") return;
    if (this.items.has(h.id)) return; // don't seed a file that's downloading

    const base: SeedItem = {
      id: h.id,
      name: h.name,
      source: h.source,
      magnet: h.magnet,
      dir: h.dir,
      sizeBytes: h.sizeBytes,
      status: "seeding",
      uploadSpeed: 0,
      uploaded: 0,
      peers: 0,
    };

    // Only hard guard we can make synchronously and portably: no magnet, no seed.
    // We do NOT guess the on-disk path (webtorrent sanitizes names per-OS); we
    // let it verify the real files and the poll safety-net flags a missing one.
    if (!h.magnet) {
      this.seeds.set(h.id, { ...base, status: "missing" });
      this.changed();
      void this.persistSeeds();
      return;
    }

    this.seeds.set(h.id, base);
    this.strayHits.set(h.id, 0);
    this.seedStartedAt.set(h.id, Date.now());
    // Seed from the stored .torrent metadata when we have it (verifies the local
    // file immediately, no swarm needed); fall back to the magnet otherwise.
    const source = torrentMetaExists(h.id) ? torrentMetaPath(h.id) : h.magnet;
    this.engine.add(h.id, source, h.dir, this.engineHandlers(h.id), this.trackers);
    this.ensurePoll();
    this.changed();
    void this.persistSeeds();
  }

  stopSeeding(id: string): void {
    const s = this.seeds.get(id);
    if (!s) return;
    this.engine.remove(id);
    this.strayHits.delete(id);
    this.seedStartedAt.delete(id);
    if (s.status === "seeding") {
      s.status = "paused";
      s.uploadSpeed = 0;
      s.peers = 0;
    }
    this.changed();
    void this.persistSeeds();
    this.maybeStopPoll();
  }

  toggleSeeding(h: HistoryItem): void {
    if (this.seeds.get(h.id)?.status === "seeding") this.stopSeeding(h.id);
    else this.startSeeding(h);
  }

  restoreSeeds(records: SeedRecord[]): void {
    for (const r of records) {
      const h = this.history.find((x) => x.id === r.id);
      if (!h) continue;
      // Respect the persisted choice: resume seeders, but leave a paused seed
      // paused (and visibly so) instead of auto-starting it.
      if (r.status === "seeding") this.startSeeding(h);
      else this.restorePaused(h);
    }
  }

  // Rebuild a paused seed from history without touching the engine, so it shows
  // as paused and stays off until the user presses p to resume it.
  private restorePaused(h: HistoryItem): void {
    if (this.seeds.has(h.id)) return;
    this.seeds.set(h.id, {
      id: h.id,
      name: h.name,
      source: h.source,
      magnet: h.magnet,
      dir: h.dir,
      sizeBytes: h.sizeBytes,
      status: "paused",
      uploadSpeed: 0,
      uploaded: 0,
      peers: 0,
    });
    this.changed();
  }

  private seedRecords(): SeedRecord[] {
    const out: SeedRecord[] = [];
    for (const s of this.seeds.values()) {
      // "missing" is a runtime detection (file gone); persist it as paused so we
      // remember the user had it without auto-seeding a file that isn't there.
      if (s.status === "seeding") out.push({ id: s.id, status: "seeding" });
      else out.push({ id: s.id, status: "paused" });
    }
    return out;
  }

  private persistSeeds(): Promise<void> {
    return saveSeeds(this.seedRecords()).catch(() => {});
  }

  restore(items: QueueItem[]): void {
    let active = 0;
    for (const raw of items) {
      this.items.set(raw.id, raw);
      if (raw.status !== "downloading") continue;
      if (this.maxDownloads === 0 || active < this.maxDownloads) {
        this.startEngine(raw);
        active++;
      } else {
        // Over the cap on boot → hold as queued (promoted as slots free).
        raw.status = "queued";
      }
    }
    if (active > 0) this.ensurePoll();
    this.changed();
    // Fill any remaining slots from persisted "queued" items.
    this.promote();
  }

  restoreHistory(items: HistoryItem[]): void {
    this.history = items.slice(0, HISTORY_MAX);
  }

  getHistory(): HistoryItem[] {
    return this.history;
  }

  private recordHistory(it: QueueItem): void {
    const rec: HistoryItem = {
      id: it.id,
      name: it.name,
      source: it.source,
      sizeBytes: it.totalBytes,
      magnet: it.magnet,
      dir: it.dir,
      completedAt: Date.now(),
    };
    this.history = [rec, ...this.history.filter((h) => h.id !== it.id)].slice(0, HISTORY_MAX);
    void saveHistory(this.history).catch(() => {});
  }

  removeHistory(id: string): void {
    const next = this.history.filter((h) => h.id !== id);
    if (next.length === this.history.length) return;
    this.history = next;
    if (this.seeds.has(id)) {
      this.engine.remove(id);
      this.seeds.delete(id);
      this.strayHits.delete(id);
      this.seedStartedAt.delete(id);
      void this.persistSeeds();
      this.maybeStopPoll();
    }
    deleteTorrentMeta(id);
    void saveHistory(this.history).catch(() => {});
    this.changed();
  }

  clearHistory(): void {
    if (this.history.length === 0) return;
    for (const h of this.history) deleteTorrentMeta(h.id);
    this.history = [];
    if (this.seeds.size > 0) {
      for (const id of this.seeds.keys()) this.engine.remove(id);
      this.seeds.clear();
      this.strayHits.clear();
      this.seedStartedAt.clear();
      void this.persistSeeds();
      this.maybeStopPoll();
    }
    void saveHistory(this.history).catch(() => {});
    this.changed();
  }

  private changed(): void {
    this.emit("update");
  }

  private async persist(): Promise<void> {
    await saveQueue(this.getItems()).catch(() => {});
  }

  // Synchronously flush every state file from current memory. Used on quit so
  // nothing depends on in-flight async writes surviving the hard exit, and so
  // history / seeds can never be lost mid-write. Touches no engine state, so it
  // can never block shutdown.
  persistSync(): void {
    saveQueueSync(this.getItems());
    saveHistorySync(this.history);
    saveSeedsSync(this.seedRecords());
  }

  suspend(): void {
    // Keep active downloads as "downloading" so restore() resumes them on the
    // next launch (mirroring how seeds auto-restore); just zero the live stats.
    for (const it of this.items.values()) {
      if (it.status === "downloading") {
        it.speed = 0;
        it.peers = 0;
        it.eta = undefined;
      }
    }
    this.persistSync();
    if (this.poll) {
      clearInterval(this.poll);
      this.poll = null;
    }
    this.engine.destroy();
  }
}
