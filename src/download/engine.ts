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

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class TorrentEngine {
  private client: WebTorrent | null = null;
  private torrents = new Map<string, Torrent>();
  private handlers = new Map<string, AddHandlers>();
  // Set by destroy(): an add() racing shutdown must not lazily build a fresh
  // client that nothing will ever destroy (its sockets would hold the event
  // loop open and hang the exit).
  private destroyed = false;

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
      const client = new WebTorrent(opts);
      // A client-level error (DHT/UDP socket failure, VPN flap, port
      // conflict) is fatal in webtorrent: it destroys every torrent WITHOUT
      // firing their per-torrent "error" events. Report the failure on each
      // tracked torrent so items surface as failed (and queued ones promote)
      // instead of freezing mid-download until a restart, then drop the
      // client so the next add() lazily builds a fresh one.
      client.on("error", (err: unknown) => {
        // A stale client (already replaced after an earlier fatal error) must
        // not fail torrents that live on its replacement.
        if (this.client !== client) return;
        this.client = null;
        const msg = message(err);
        const stalled = [...this.torrents.entries()];
        this.torrents.clear();
        for (const [id, t] of stalled) {
          const h = this.handlers.get(id);
          this.handlers.delete(id);
          try {
            t.destroy();
          } catch {}
          h?.onError?.(msg);
        }
        try {
          client.destroy();
        } catch {}
      });
      this.client = client;
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
    if (this.destroyed) {
      handlers.onError?.("engine is shut down");
      return;
    }
    const client = this.ensureClient();
    const existing = this.torrents.get(id);
    if (existing) {
      this.torrents.delete(id);
      this.handlers.delete(id);
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
    this.handlers.set(id, handlers);

    torrent.on("metadata", () => {
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
      this.handlers.delete(id);
      try {
        torrent.destroy();
      } catch {}
    });
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
    let timeRemaining = Infinity;

    try {
      progress = t.progress;
      downloaded = t.downloaded;
      timeRemaining = t.timeRemaining;
    } catch (err) {
      // Ignore webtorrent getter errors that occur before metadata is fully parsed
    }

    return {
      progress,
      downloaded,
      total: t.length || 0,
      speed: t.downloadSpeed || 0,
      uploadSpeed: t.uploadSpeed || 0,
      uploaded: t.uploaded || 0,
      peers: t.numPeers || 0,
      timeRemaining,
      name: t.name || '',
    };
  }

  remove(id: string): void {
    const t = this.torrents.get(id);
    this.torrents.delete(id);
    this.handlers.delete(id);
    if (t) {
      try {
        t.destroy();
      } catch {}
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.torrents.clear();
    this.handlers.clear();
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
