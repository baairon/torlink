declare module "parse-torrent" {
  interface ParsedTorrentFile {
    path: string;
    name: string;
    length: number;
    offset: number;
  }
  interface ParsedTorrent {
    infoHash: string;
    name?: string;
    announce?: string[];
    length?: number;
    files?: ParsedTorrentFile[];
  }
  export default function parseTorrent(
    torrentId: Uint8Array | string,
  ): Promise<ParsedTorrent>;
}
