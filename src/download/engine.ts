import { extname } from "node:path";
import WebTorrent, { type Torrent, type TorrentFile, type TorrentServer } from "webtorrent";

const MEDIA_EXT = new Set([
  ".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v", ".mpg", ".mpeg", ".flv",
  ".wmv", ".m2ts", ".ts", ".mp3", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".wav",
]);

// The largest media file in a multi-file torrent, else the largest file of any
// kind. Exported for testing.
export function pickBestFile(files: TorrentFile[]): TorrentFile | null {
  const media = files.filter((f) => MEDIA_EXT.has(extname(f.name).toLowerCase()));
  const pool = media.length > 0 ? media : files;
  let best: TorrentFile | null = null;
  for (const f of pool) {
    if (!best || f.length > best.length) best = f;
  }
  return best;
}

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
  private streamServer: TorrentServer | null = null;
  // Started lazily on first stream so an ordinary session never opens the port;
  // resolves to the bound port and is reused thereafter.
  private streamServerReady: Promise<number> | null = null;

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

  // The TCP port the client accepts incoming peers on (diagnostics / tests).
  listenPort(): number | null {
    return this.client?.torrentPort ?? null;
  }

  // Loopback-only, so a partially-downloaded file is never exposed on the network.
  private ensureStreamServer(): Promise<number> {
    if (this.streamServerReady) return this.streamServerReady;
    const client = this.ensureClient();
    const instance = client.createServer();
    this.streamServer = instance;
    this.streamServerReady = new Promise<number>((resolve, reject) => {
      const wanted = Number(process.env.TORLINK_STREAM_PORT) || 0;
      instance.server.once("error", reject);
      instance.server.listen(wanted, "127.0.0.1", () => {
        const addr = instance.server.address();
        if (addr && typeof addr === "object") resolve(addr.port);
        else reject(new Error("stream server did not bind a port"));
      });
    });
    return this.streamServerReady;
  }

  // Playable URL for a file in a (possibly still-downloading) torrent, or null
  // before metadata arrives. Defaults to the largest media file.
  async getStreamUrl(id: string, fileIndex?: number): Promise<string | null> {
    const t = this.torrents.get(id);
    const files = t?.files;
    if (!files || files.length === 0) return null;
    const file = fileIndex != null ? files[fileIndex] : pickBestFile(files);
    if (!file) return null;
    try {
      const port = await this.ensureStreamServer();
      // webtorrent's own `file.streamURL` is only a path, so build the absolute
      // URL. The server matches on decodeURI(path.replace(/\\/g, "/")).
      const path = encodeURI(file.path.replace(/\\/g, "/"));
      return `http://127.0.0.1:${port}/webtorrent/${t.infoHash}/${path}`;
    } catch {
      return null;
    }
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
    if (t) {
      try {
        t.destroy();
      } catch {}
    }
  }

  destroy(): void {
    this.torrents.clear();
    const server = this.streamServer;
    this.streamServer = null;
    this.streamServerReady = null;
    if (server) {
      try {
        server.close();
      } catch {}
    }
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
