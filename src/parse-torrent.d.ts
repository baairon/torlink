declare module "parse-torrent" {
  interface ParsedTorrent {
    infoHash: string;
    name?: string;
    announce?: string[];
    length?: number;
    files?: Array<{
      name?: string;
      path?: string;
      length: number;
    }>;
  }
  export default function parseTorrent(
    torrentId: Uint8Array | string,
  ): Promise<ParsedTorrent>;
}
