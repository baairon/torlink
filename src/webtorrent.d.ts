declare module "webtorrent" {
  import type { EventEmitter } from "node:events";

  interface TorrentFile {
    name: string;
    path: string;
    length: number;
  }

  interface Torrent extends EventEmitter {
    infoHash: string;
    magnetURI: string;
    torrentFile: Uint8Array;
    ready: boolean;
    name: string;
    length: number;
    downloaded: number;
    uploaded: number;
    downloadSpeed: number;
    uploadSpeed: number;
    progress: number;
    numPeers: number;
    timeRemaining: number;
    done: boolean;
    paused: boolean;
    path: string;
    files: TorrentFile[];
    pause(): void;
    resume(): void;
    addPeer(peer: string): boolean;
    destroy(cb?: (err?: Error) => void): void;
  }

  interface TorrentOptions {
    path?: string;
    announce?: string[];
  }

  interface WebTorrentOptions {
    maxConns?: number;
    dht?: boolean;
    utp?: boolean;
    tracker?: boolean;
    lsd?: boolean;
    natPmp?: boolean;
    natUpnp?: boolean | "permanent";
    utp?: boolean;
  }

  class WebTorrent extends EventEmitter {
    constructor(opts?: WebTorrentOptions);
    readonly torrents: Torrent[];
    readonly downloadSpeed: number;
    readonly uploadSpeed: number;
    readonly torrentPort: number;
    add(
      torrentId: string,
      opts?: TorrentOptions,
      cb?: (torrent: Torrent) => void,
    ): Torrent;
    seed(
      input: string | string[],
      opts?: TorrentOptions,
      cb?: (torrent: Torrent) => void,
    ): Torrent;
    get(torrentId: string): Torrent | null;
    remove(torrentId: string, cb?: (err?: Error) => void): void;
    destroy(cb?: (err?: Error) => void): void;
  }

  export default WebTorrent;
  export type { Torrent, TorrentFile };
}
