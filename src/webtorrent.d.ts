declare module "webtorrent" {
  import type { EventEmitter } from "node:events";

  interface TorrentFile {
    name: string;
    path: string;
    length: number;
  }

  interface Wire {
    // tcpIncoming, tcpOutgoing, utpIncoming, utpOutgoing, webrtc, webSeed
    type: string;
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
    wires: Wire[];
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
    tracker?: boolean | { wrtc?: boolean };
    torrentPort?: number;
    dhtPort?: number;
    lsd?: boolean;
    natPmp?: boolean;
    natUpnp?: boolean | "permanent";
  }

  class WebTorrent extends EventEmitter {
    constructor(opts?: WebTorrentOptions);
    readonly torrents: Torrent[];
    readonly downloadSpeed: number;
    readonly uploadSpeed: number;
    readonly torrentPort: number;
    readonly listening: boolean;
    readonly destroyed: boolean;
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
