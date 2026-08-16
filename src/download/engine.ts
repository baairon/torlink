import WebTorrent, { type Torrent } from "webtorrent";

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
  // The .torrent metadata (piece hashes), available once metadata arrives. We
  // persist it so a later re-seed can verify the on-disk file without having to
  // re-fetch metadata from the swarm (which a bare magnet would require).
  torrentFile?: Uint8Array;
}

export interface AddHandlers {
  onMetadata?: (meta: TorrentMeta) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}

export function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class TorrentEngine {
  private client: WebTorrent | null = null;
  private torrents = new Map<string, Torrent>();
  // For torrents with excluded files: the total bytes of the *selected* files.
  // webtorrent's own progress/length always count the whole torrent, so a
  // partial download would otherwise stall below 100%. Set once metadata
  // arrives; stats() rescales progress/eta against it.
  private selectedBytes = new Map<string, number>();

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
  // `exclude` lists file indices to skip. When set, the torrent is added with
  // nothing selected and only the kept files are re-selected once metadata
  // arrives, so excluded files never touch disk.
  add(
    id: string,
    source: string,
    dir: string,
    handlers: AddHandlers,
    announce?: string[],
    exclude?: number[],
  ): void {
    const client = this.ensureClient();
    const existing = this.torrents.get(id);
    if (existing) {
      this.torrents.delete(id);
      try {
        existing.destroy();
      } catch {}
    }
    this.selectedBytes.delete(id);

    const excluding = !!exclude && exclude.length > 0;
    const opts = {
      path: dir,
      ...(announce && announce.length > 0 ? { announce } : {}),
      // With no files selected, webtorrent downloads nothing until we select the
      // ones to keep in the metadata handler below.
      ...(excluding ? { deselect: true } : {}),
    };
    let torrent: Torrent;
    try {
      torrent = client.add(source, opts);
    } catch (e) {
      handlers.onError?.(message(e));
      return;
    }
    this.torrents.set(id, torrent);

    torrent.on("metadata", () => {
      let total = torrent.length;
      if (excluding) {
        const skip = new Set(exclude);
        let selected = 0;
        (torrent.files ?? []).forEach((f, i) => {
          if (skip.has(i)) {
            f.deselect();
          } else {
            f.select();
            selected += f.length;
          }
        });
        this.selectedBytes.set(id, selected);
        total = selected;
      }
      handlers.onMetadata?.({
        name: torrent.name,
        total,
        files: torrent.files?.length ?? 0,
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
  }

  // Change which files a *running* torrent downloads, in place. Deselects only
  // the excluded files, then re-asserts the kept ones — so the kept selections
  // stay live the whole time and the torrent never goes idle (emptying every
  // selection would drop peer interest and stall/re-ramp the download, looking
  // like a restart). The two passes must run in this order: deselecting an
  // excluded file also drops any piece it shares on a boundary with a kept file,
  // and the second pass re-selects that piece back. Already-downloaded data
  // stays on disk. Returns the selected byte total (whole torrent when nothing
  // is excluded), or null when the torrent isn't present or has no metadata yet.
  reselect(id: string, exclude: number[]): number | null {
    const t = this.torrents.get(id);
    const files = t?.files;
    if (!t || !files || files.length === 0) return null;
    const skip = new Set(exclude);
    // Pass 1: drop the excluded files.
    files.forEach((f, i) => {
      if (skip.has(i)) f.deselect();
    });
    // Pass 2: re-assert the kept files (restores any shared boundary pieces).
    let selected = 0;
    files.forEach((f, i) => {
      if (!skip.has(i)) {
        f.select();
        selected += f.length;
      }
    });
    if (skip.size > 0) {
      this.selectedBytes.set(id, selected);
      return selected;
    }
    this.selectedBytes.delete(id);
    return t.length;
  }

  // The TCP port the client accepts incoming peers on (diagnostics / tests).
  listenPort(): number | null {
    return this.client?.torrentPort ?? null;
  }

  stats(id: string): TorrentProgress | null {
    const t = this.torrents.get(id);
    if (!t) return null;

    let progress = 0;
    let downloaded = 0;
    let total = 0;
    let speed = 0;
    let uploadSpeed = 0;
    let uploaded = 0;
    let peers = 0;
    let timeRemaining = Infinity;
    let name = "";

    try {
      progress = t.progress || 0;
      downloaded = t.downloaded || 0;
      total = t.length || 0;
      speed = t.downloadSpeed || 0;
      uploadSpeed = t.uploadSpeed || 0;
      uploaded = t.uploaded || 0;
      peers = t.numPeers || 0;
      timeRemaining = typeof t.timeRemaining === "number" && !isNaN(t.timeRemaining) ? t.timeRemaining : Infinity;
      name = t.name || "";

      // Excluded-file downloads: rescale against the selected bytes so progress
      // and eta track only what we're actually fetching, not the whole torrent.
      // webtorrent may still pull a few shared bytes of a deselected piece, so
      // clamp to avoid overshooting 100%.
      const selected = this.selectedBytes.get(id);
      if (selected !== undefined && selected > 0) {
        total = selected;
        progress = Math.min(1, downloaded / selected);
        const remaining = selected - downloaded;
        timeRemaining = speed > 0 && remaining > 0 ? (remaining / speed) * 1000 : 0;
      }
    } catch {
      // Every stat is read inside this try on purpose: webtorrent getters can
      // throw before metadata parses and on a torrent in an error state, and
      // stats() runs from the poll interval, where an escaping throw is an
      // uncaught exception. Partial numbers beat a dead poller.
    }

    return {
      progress,
      downloaded,
      total,
      speed,
      uploadSpeed,
      uploaded,
      peers,
      timeRemaining,
      name,
    };
  }

  remove(id: string): void {
    const t = this.torrents.get(id);
    this.torrents.delete(id);
    this.selectedBytes.delete(id);
    if (t) {
      try {
        t.destroy();
      } catch {}
    }
  }

  destroy(): void {
    this.torrents.clear();
    this.selectedBytes.clear();
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
}
