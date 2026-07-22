declare module "parse-torrent" {
  interface ParsedTorrent {
    // infoHash can be undefined in practice when parseTorrent resolves a truthy
    // object but cannot derive a hash from the input (e.g. malformed magnet).
    // Webtorrent's _onTorrentId checks `if (parsedTorrent)` but then calls
    // arr2hex(parsedTorrent.infoHash) without guarding for undefined, crashing.
    infoHash?: string;
    name?: string;
  }
  export default function parseTorrent(
    torrentId: Uint8Array | string,
  ): Promise<ParsedTorrent>;
}
