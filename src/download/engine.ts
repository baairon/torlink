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

export interface FileInfo {
  name: string;
  path: string;
  length: number;
}

export interface TorrentMeta {
  name: string;
  total: number;
  files: number;
  fileList: FileInfo[];
  // The .torrent metadata (piece hashes), available once metadata arrives. We
  // persist it so a later re-seed can verify the on-disk file without having to
  // re-fetch metadata from the swarm (which a bare magnet would require).
  torrentFile?: Uint8Array;
}

// Which files an `add` should fetch. `metaOnly` selects nothing (used by
// queue.prepare to probe metadata without downloading); `deselected` selects
// every file *except* the given indices. Neither present means "everything"
// (the default, unthrottled path).
export interface SelectionOptions {
  deselected?: number[];
  metaOnly?: boolean;
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

  private ensureClient(): WebTorrent {
    if (!this.client) {
      this.client = new WebTorrent();
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
    selection?: SelectionOptions,
  ): void {
    const client = this.ensureClient();
    const existing = this.torrents.get(id);
    if (existing) {
      this.torrents.delete(id);
      try {
        existing.destroy();
      } catch {}
    }

    const opts: { path?: string; announce?: string[]; deselect?: boolean } = { path: dir };
    if (announce && announce.length > 0) opts.announce = announce;
    // A partial selection (or a metadata-only probe) needs webtorrent's
    // deselect opt *and* an explicit deselect-all once metadata arrives below
    // -- `deselect: true` alone doesn't reliably stop the whole-torrent
    // auto-select webtorrent does on add.
    const selective = Boolean(selection?.metaOnly || selection?.deselected);
    if (selective) opts.deselect = true;

    let torrent: Torrent;
    try {
      torrent = client.add(source, opts);
    } catch (e) {
      handlers.onError?.(message(e));
      return;
    }
    this.torrents.set(id, torrent);

    torrent.on("metadata", () => {
      const fileList: FileInfo[] = (torrent.files ?? []).map((f) => ({
        name: f.name,
        path: f.path,
        length: f.length,
      }));

      if (selective && torrent.pieces?.length) {
        torrent.deselect(0, torrent.pieces.length - 1, false);
      }
      if (selection?.metaOnly) {
        // Select nothing: this add exists only to fetch metadata.
      } else if (selection?.deselected) {
        const off = new Set(selection.deselected);
        torrent.files.forEach((f, i) => {
          if (!off.has(i)) f.select();
        });
      }

      handlers.onMetadata?.({
        name: torrent.name,
        total: torrent.length,
        files: torrent.files?.length ?? 0,
        fileList,
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

  // Live selection edits for a torrent already in progress (during-download
  // file toggling). No-ops before metadata / out of range.
  selectFile(id: string, index: number): void {
    const t = this.torrents.get(id);
    if (!t?.files || index < 0 || index >= t.files.length) return;
    t.files[index]?.select();
  }

  deselectFile(id: string, index: number): void {
    const t = this.torrents.get(id);
    if (!t?.files || index < 0 || index >= t.files.length) return;
    t.files[index]?.deselect();
  }

  files(id: string): FileInfo[] | null {
    const t = this.torrents.get(id);
    if (!t?.files) return null;
    return t.files.map((f) => ({ name: f.name, path: f.path, length: f.length }));
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
