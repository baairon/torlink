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
  private selections = new Map<string, boolean[]>();

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
    selections?: boolean[],
  ): void {
    const client = this.ensureClient();
    const existing = this.torrents.get(id);
    if (existing) {
      this.torrents.delete(id);
      this.selections.delete(id);
      try {
        existing.destroy();
      } catch {}
    }

    if (selections) {
      this.selections.set(id, selections);
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
      if (selections && torrent.files) {
        for (let i = 0; i < torrent.files.length; i++) {
          if (i < selections.length && !selections[i]) {
            torrent.files[i]!.deselect();
          }
        }
      }
      handlers.onMetadata?.({
        name: torrent.name,
        total: torrent.length,
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
      this.selections.delete(id);
      try {
        torrent.destroy();
      } catch {}
    });
  }

  fetchMetadata(
    source: string,
    trackers: string[],
    onResult: (meta: TorrentMeta, files: { path: string; length: number }[]) => void,
    onError: (err: Error) => void
  ): () => void {
    const client = this.ensureClient();
    
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const memoryStore = require("memory-chunk-store");
    const opts = trackers.length > 0 ? { announce: trackers, store: memoryStore } : { store: memoryStore };
    
    let torrent: Torrent;
    try {
      torrent = client.add(source, opts);
    } catch (e) {
      onError(e instanceof Error ? e : new Error(String(e)));
      return () => {};
    }

    const onMetadata = () => {
      onResult({
        name: torrent.name,
        total: torrent.length,
        files: torrent.files?.length ?? 0,
        torrentFile: torrent.torrentFile,
      }, (torrent.files || []).map((f) => ({ path: f.path, length: f.length })));
    };

    if (torrent.ready || (torrent as any).metadata) {
      onMetadata();
      return () => {};
    }

    const cleanup = () => {
      try {
        torrent.destroy();
      } catch {}
    };

    torrent.on("metadata", () => {
      onMetadata();
      cleanup();
    });

    torrent.on("error", (err: unknown) => {
      onError(err instanceof Error ? err : new Error(String(err)));
      cleanup();
    });

    return cleanup;
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
      const sel = this.selections.get(id);
      let customSels = false;
      if (sel && t.files) {
        for (let i = 0; i < t.files.length; i++) {
          if (i < sel.length && !sel[i]) {
            customSels = true;
            break;
          }
        }
      }

      speed = t.downloadSpeed || 0;
      if (customSels && t.files) {
        let selTotal = 0;
        let selDown = 0;
        for (let i = 0; i < t.files.length; i++) {
          if (i < sel!.length && sel![i]) {
            selTotal += t.files[i]!.length;
            selDown += t.files[i]!.downloaded;
          }
        }
        total = selTotal;
        downloaded = Math.min(total, selDown);
        progress = total === 0 ? 1 : downloaded / total;
        timeRemaining = speed > 0 ? ((total - downloaded) / speed) * 1000 : Infinity;
      } else {
        progress = t.progress || 0;
        downloaded = t.downloaded || 0;
        total = t.length || 0;
        timeRemaining = t.timeRemaining;
      }

      uploadSpeed = t.uploadSpeed || 0;
      uploaded = t.uploaded || 0;
      peers = t.numPeers || 0;
      name = t.name || "";
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
    if (!t) return;
    this.torrents.delete(id);
    this.selections.delete(id);
    try {
      t.destroy();
    } catch {}
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
}
