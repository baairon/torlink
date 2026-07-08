import WebTorrent, { type Torrent } from "webtorrent";
import type { TorrentFileInfo, PeerInfo } from "./types";
import { saveTorrentMeta } from "./persist";

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
  private server: any = null;
  private deselectedFiles = new Map<string, Set<string>>();
  private pendingMetadata = new Map<string, Promise<TorrentFileInfo[]>>();
  private throttleEnabled = false;
  private throttleDown = -1;
  private throttleUp = -1;

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
      this.applyThrottle();
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
    this.applyThrottle();

    torrent.on("metadata", () => {
      const deselected = this.deselectedFiles.get(id);
      if (deselected && torrent.files) {
        // Deselect unwanted files
        for (const f of torrent.files) {
          if (deselected.has(f.path)) {
            f.deselect();
          }
        }
        // WebTorrent's file.deselect() drops shared pieces. We must re-select 
        // the files we DO want to ensure shared pieces are restored to the download pool.
        for (const f of torrent.files) {
          if (!deselected.has(f.path)) {
            f.select();
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
      this.remove(id);
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

  getFiles(id: string): TorrentFileInfo[] | null {
    const t = this.torrents.get(id);
    if (!t || !t.files) return null;
    const deselected = this.deselectedFiles.get(id) || new Set<string>();
    return t.files.map((f) => ({
      path: f.path,
      length: f.length,
      downloaded: f.downloaded,
      selected: !deselected.has(f.path),
    }));
  }

  async fetchMetadata(id: string, magnet: string): Promise<TorrentFileInfo[]> {
    // Check if it's already active
    const existing = this.torrents.get(id);
    if (existing && existing.files) {
      return this.getFiles(id)!;
    }

    if (this.pendingMetadata.has(id)) {
      return this.pendingMetadata.get(id)!;
    }

    const promise = new Promise<TorrentFileInfo[]>((resolve, reject) => {
      const client = this.ensureClient();
      const t = client.add(magnet, { destroyStoreOnDestroy: true } as any, (t) => {
        if (t.torrentFile) {
          void saveTorrentMeta(id, t.torrentFile);
        }
        const files = t.files.map((f) => ({
          path: f.path,
          length: f.length,
          downloaded: 0,
          selected: true,
        }));
        t.destroy();
        this.pendingMetadata.delete(id);
        resolve(files);
      });
      t.on("error", (err) => {
        t.destroy();
        this.pendingMetadata.delete(id);
        reject(err);
      });
    });

    this.pendingMetadata.set(id, promise);
    return promise;
  }

  isDeselected(id: string, path: string): boolean {
    const deselected = this.deselectedFiles.get(id);
    return deselected ? deselected.has(path) : false;
  }

  toggleFileSelection(id: string, path: string, selected: boolean): void {
    let deselected = this.deselectedFiles.get(id);
    if (!deselected) {
      deselected = new Set<string>();
      this.deselectedFiles.set(id, deselected);
    }

    if (selected) {
      deselected.delete(path);
    } else {
      deselected.add(path);
    }

    const t = this.torrents.get(id);
    if (t && t.files) {
      const file = t.files.find((f) => f.path === path);
      if (file) {
        if (selected) {
          file.select();
        } else {
          file.deselect();
          // Restore any shared pieces that WebTorrent just dropped
          for (const f of t.files) {
            if (!deselected.has(f.path)) {
              f.select();
            }
          }
        }
      }
    }
  }

  getPeers(id: string): PeerInfo[] | null {
    const t = this.torrents.get(id);
    if (!t) return null;
    
    // WebTorrent's "wires" represent the active peer connections
    // @ts-ignore - wires is an internal property not in the DT typings
    const wires: any[] = t.wires || [];
    
    return wires.map((w) => ({
      ip: w.remoteAddress || "Unknown",
      client: w.peerExtendedHandshake?.v || "Unknown",
      peerId: w.peerId || "Unknown",
      downloaded: w.downloaded || 0,
      uploaded: w.uploaded || 0,
      downSpeed: w.downloadSpeed ? w.downloadSpeed() : 0,
      upSpeed: w.uploadSpeed ? w.uploadSpeed() : 0,
    }));
  }

  async stream(id: string, targetPath?: string): Promise<string | null> {
    const t = this.torrents.get(id);
    if (!t || !t.files || t.files.length === 0) return null;

    if (!this.server) {
      this.server = this.client!.createServer();
      await new Promise<void>((resolve) => {
        this.server.listen(0, resolve);
      });
    }

    const port = this.server.address().port;
    
    let targetFile = targetPath ? t.files.find(f => f.path === targetPath) : undefined;
    if (!targetFile) {
      targetFile = t.files[0]!;
      t.files.forEach((f) => {
        if (f.name.match(/\.(mp4|mkv|avi|webm)$/i)) {
          if (!targetFile!.name.match(/\.(mp4|mkv|avi|webm)$/i) || f.length > targetFile!.length) {
            targetFile = f;
          }
        }
      });
    }

    const filePath = targetFile.path.replace(/\\/g, '/');
    return `http://localhost:${port}/webtorrent/${t.infoHash}/${encodeURI(filePath)}`;
  }

  setThrottle(enabled: boolean, downLimit: number, upLimit: number): void {
    this.throttleEnabled = enabled;
    this.throttleDown = downLimit;
    this.throttleUp = upLimit;
    this.applyThrottle();
  }

  private applyThrottle(): void {
    if (!this.client) return;
    // @ts-ignore - throttleDownload and throttleUpload are not in the outdated DefinitelyTyped definitions
    this.client.throttleDownload(this.throttleEnabled ? this.throttleDown : -1);
    // @ts-ignore
    this.client.throttleUpload(this.throttleEnabled ? this.throttleUp : -1);
  }

  remove(id: string): void {
    const t = this.torrents.get(id);
    this.torrents.delete(id);
    this.deselectedFiles.delete(id);
    if (t) {
      try {
        t.destroy();
      } catch {}
    }
  }

  destroy(): void {
    if (this.server) {
      try {
        this.server.close();
      } catch {}
      this.server = null;
    }
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
