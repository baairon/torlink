import { truncate } from "node:fs/promises";
import path from "node:path";
import WebTorrent, { type Torrent, type TorrentFile } from "webtorrent";
import type { TorrentFileInfo } from "./types";

export interface TorrentProgress {
  progress: number;
  downloaded: number;
  total: number;
  speed: number;
  uploadSpeed: number;
  uploaded: number;
  peers: number;
  timeRemaining: number;
  name: string;
}

export interface TorrentMeta {
  name: string;
  total: number;
  files: number;
  fileList?: TorrentFileInfo[];
  // The .torrent metadata (piece hashes), available once metadata arrives. We
  // persist it so a later re-seed can verify the on-disk file without having to
  // re-fetch metadata from the swarm (which a bare magnet would require).
  torrentFile?: Uint8Array;
}

export interface AddHandlers {
  onMetadata?: (meta: TorrentMeta) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
  onReady?: () => void;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class TorrentEngine {
  private client: WebTorrent | null = null;
  private torrents = new Map<string, Torrent>();
  // Indices of deselected files per torrent, so the download event can
  // re-truncate files that receive data due to piece-boundary overlap.
  private deselected = new Map<string, Set<number>>();

  private ensureClient(): WebTorrent {
    if (!this.client) {
      // On macOS, mDNSResponder occupies UDP port 5350 — the NAT-PMP
      // client port. Binding it fails asynchronously with EADDRINUSE,
      // and since the PMP client is a raw EventEmitter with no error
      // listener, the error surfaces as an uncaughtException that kills
      // the app the moment a download starts. NAT-PMP can never succeed
      // on macOS because the port is permanently taken, so disable it
      // and let UPnP handle NAT traversal instead.
      const opts = process.platform === "darwin" ? { natPmp: false } : {};
      this.client = new WebTorrent(opts);
      this.client.on("error", () => {});
    }
    return this.client;
  }

  // `source` is a magnet URI, an infoHash, or a path to a .torrent file. Seeding
  // an existing file passes the stored .torrent path so webtorrent can verify it
  // locally instead of re-fetching metadata from the swarm.
  // `announce` supplements whatever trackers are already in the source URI;
  // webtorrent dedupes internally.
  add(
    id: string,
    source: string,
    dir: string,
    handlers: AddHandlers,
    announce?: string[],
  ): void {
    const client = this.ensureClient();
    const existing = this.torrents.get(id);
    if (existing) {
      this.torrents.delete(id);
      try {
        existing.destroy();
      } catch {}
    }

    const opts = announce && announce.length > 0 ? { path: dir, announce } : { path: dir };
    let torrent: Torrent;
    try {
      torrent = client.add(source, opts);
    } catch (e) {
      handlers.onError?.(message(e));
      return;
    }
    this.torrents.set(id, torrent);

    torrent.on("metadata", () => {
      handlers.onMetadata?.({
        name: torrent.name,
        total: torrent.length,
        files: torrent.files?.length ?? 0,
        fileList: (torrent.files ?? []).map((f) => ({
          name: f.name,
          path: f.path,
          length: f.length,
        })),
        torrentFile: torrent.torrentFile,
      });
    });
    torrent.on("done", () => {
      // A finished torrent is a complete, verified torrent: keep it alive so it
      // can seed. The queue owns its lifetime from here (remove/destroy).
      handlers.onDone?.();
    });
    torrent.on("error", (err: unknown) => {
      handlers.onError?.(message(err));
      this.torrents.delete(id);
      try {
        torrent.destroy();
      } catch {}
    });
    torrent.on("ready", () => {
      handlers.onReady?.();
    });
  }

  // The TCP port the client accepts incoming peers on (diagnostics / tests).
  listenPort(): number | null {
    return this.client?.torrentPort ?? null;
  }

  stats(id: string): TorrentProgress | null {
    const t = this.torrents.get(id);
    if (!t) return null;
    return {
      progress: t.progress,
      downloaded: t.downloaded,
      total: t.length,
      speed: t.downloadSpeed,
      uploadSpeed: t.uploadSpeed,
      uploaded: t.uploaded,
      peers: t.numPeers,
      timeRemaining: t.timeRemaining,
      name: t.name,
    };
  }

  remove(id: string): void {
    const t = this.torrents.get(id);
    this.torrents.delete(id);
    if (t) {
      try {
        t.destroy();
      } catch {}
    }
  }

  // Select/deselect files at the piece level.
  // Unselected files won't have their pieces requested, but piece-boundary
  // overlap can still cause data to land in deselected files.
  selectFiles(id: string, selectedIndices: number[]): void {
    const t = this.torrents.get(id);
    if (!t || !t.files) return;
    const set = new Set(selectedIndices);
    t.files.forEach((f, i) => {
      if (set.has(i)) f.select();
      else f.deselect();
    });
  }

  // Wraps the torrent's store.put to zero out bytes belonging to unselected
  // files. Combined with piece-level deselection (selectFiles), this ensures
  // unselected file data never hits the disk, even when pieces span files.
  applyFileFilter(id: string, selectedIndices: number[], dir: string): void {
    const t = this.torrents.get(id);
    if (!t || !t.files || !t.store) return;

    const selectedSet = new Set(selectedIndices);
    const deselectedSet = new Set<number>();
    for (let i = 0; i < t.files.length; i++) {
      if (!selectedSet.has(i)) deselectedSet.add(i);
    }
    this.deselected.set(id, deselectedSet);

    // Truncate deselected files to 0 bytes (initial sparse files).
    if (deselectedSet.size > 0) {
      for (const i of deselectedSet) {
        const full = path.join(dir, t.files[i]!.path);
        truncate(full, 0).catch(() => {});
      }
    }

    // Compute piece-to-byte-range mapping for unselected files.
    // A piece at index p covers bytes [p * pieceLen, (p+1) * pieceLen).
    const pieceLen = t.pieceLength;
    if (!pieceLen || deselectedSet.size === 0) return;

    const totalPieces = Math.ceil(t.length / pieceLen);
    // Build file offset table: for each file, its byte range in the torrent.
    const fileRanges: { idx: number; start: number; end: number }[] = [];
    let fileOffset = 0;
    for (let i = 0; i < t.files.length; i++) {
      const end = fileOffset + t.files[i]!.length - 1;
      fileRanges.push({ idx: i, start: fileOffset, end });
      fileOffset = end + 1;
    }

    // Precompute zero-ranges per piece: byte ranges (within the piece buffer)
    // that belong to unselected files.
    const zeroRanges = new Map<number, { start: number; end: number }[]>();
    for (let p = 0; p < totalPieces; p++) {
      const pStart = p * pieceLen;
      const pEnd = Math.min((p + 1) * pieceLen - 1, t.length - 1);
      const ranges: { start: number; end: number }[] = [];
      for (const fr of fileRanges) {
        if (selectedSet.has(fr.idx)) continue;
        const oStart = Math.max(fr.start, pStart);
        const oEnd = Math.min(fr.end, pEnd);
        if (oStart <= oEnd) {
          ranges.push({ start: oStart - pStart, end: oEnd - pStart });
        }
      }
      if (ranges.length > 0) zeroRanges.set(p, ranges);
    }

    if (zeroRanges.size === 0) return;

    // Wrap store.put: zero out unselected file bytes before writing.
    const originalPut = t.store.put.bind(t.store);
    t.store.put = async (pieceIndex: number, buffer: Buffer) => {
      const ranges = zeroRanges.get(pieceIndex);
      if (ranges && Buffer.isBuffer(buffer)) {
        buffer = Buffer.from(buffer);
        for (const r of ranges) {
          buffer.fill(0, r.start, r.end + 1);
        }
      }
      return originalPut(pieceIndex, buffer);
    };
  }

  destroy(): void {
    this.torrents.clear();
    // Never block shutdown on webtorrent's async teardown: hand off the client
    // destroy to a later tick and let the OS reclaim sockets if we exit first.
    const client = this.client;
    this.client = null;
    if (client) {
      setImmediate(() => {
        try {
          client.destroy();
        } catch {}
      });
    }
  }

  // Creates a temporary WebTorrent client, adds the magnet, waits for metadata,
  // deselects all files (so no data downloads), extracts the file list, then
  // destroys the temp client. Returns the file list or throws on error / timeout.
  fetchFileList(
    magnet: string,
    announce?: string[],
    timeoutMs = 30_000,
  ): Promise<TorrentFileInfo[]> {
    return new Promise((resolve, reject) => {
      const opts = process.platform === "darwin" ? { natPmp: false } : {};
      const client = new WebTorrent(opts);
      client.on("error", () => {});

      const addOpts = announce && announce.length > 0 ? { announce } : {};
      let torrent: Torrent;
      try {
        torrent = client.add(magnet, addOpts);
      } catch (e) {
        setImmediate(() => {
          try { client.destroy(); } catch {}
        });
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }

      const timer = setTimeout(() => {
        try { torrent.destroy(); } catch {}
        setImmediate(() => {
          try { client.destroy(); } catch {}
        });
        reject(new Error("Timed out fetching file list"));
      }, timeoutMs);

      torrent.on("metadata", () => {
        clearTimeout(timer);
        const files: TorrentFileInfo[] = (torrent.files ?? []).map(
          (f: TorrentFile) => ({
            name: f.name,
            path: f.path,
            length: f.length,
          }),
        );
        // Deselect all so nothing downloads during the brief window before
        // the temp client is destroyed.
        for (const f of torrent.files ?? []) f.deselect();

        setImmediate(() => {
          try { torrent.destroy(); } catch {}
          try { client.destroy(); } catch {}
        });
        resolve(files);
      });

      torrent.on("error", (err: unknown) => {
        clearTimeout(timer);
        setImmediate(() => {
          try { torrent.destroy(); } catch {}
          try { client.destroy(); } catch {}
        });
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }
}
