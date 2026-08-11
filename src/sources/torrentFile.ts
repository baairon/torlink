import { promises as fs } from "node:fs";
import parseTorrent from "parse-torrent";
import { buildMagnet, type ParsedMagnet } from "./magnet";

// A .torrent is metadata, not payload: even a torrent with tens of thousands of
// pieces stays in the low megabytes. The cap is what keeps a mis-named disk
// image dropped in the watch folder from being pulled into memory whole.
const MAX_TORRENT_BYTES = 16 * 1024 * 1024;

export async function magnetFromTorrentFile(path: string): Promise<ParsedMagnet | null> {
  try {
    const stat = await fs.stat(path);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_TORRENT_BYTES) return null;
    const buf = await fs.readFile(path);
    const parsed = await parseTorrent(new Uint8Array(buf));
    const infoHash = parsed?.infoHash?.toLowerCase();
    if (!infoHash) return null;
    const name = parsed.name || infoHash;
    // Carry the file's own announce list into the magnet. Without it a torrent
    // that isn't on the public DHT — a private tracker, a small private swarm —
    // sits at zero peers forever, and on a private tracker the passkey that
    // makes an announce work at all lives in that URL.
    const announce = Array.isArray(parsed.announce)
      ? parsed.announce.filter((url): url is string => typeof url === "string")
      : [];
    return { infoHash, name, magnet: buildMagnet(infoHash, name, announce) };
  } catch {
    return null;
  }
}
