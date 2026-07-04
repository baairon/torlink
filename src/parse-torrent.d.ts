declare module "parse-torrent" {
  interface ParsedTorrent {
    infoHash: string;
    name?: string;
  }
  export default function parseTorrent(
    torrentId: Uint8Array | string,
  ): Promise<ParsedTorrent>;
}
