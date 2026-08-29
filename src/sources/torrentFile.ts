import { promises as fs } from "node:fs";
import parseTorrent from "parse-torrent";
import { buildMagnet, type ParsedMagnet } from "./magnet";

// A .torrent is metadata, not payload: even a torrent with tens of thousands of
// pieces stays in the low megabytes. The cap is what keeps a mis-named disk
// image dropped in the watch folder from being pulled into memory whole.
const MAX_TORRENT_BYTES = 16 * 1024 * 1024;

// The same read, from bytes already in hand rather than a path. The HTTP add
// API needs this: it accepts an uploaded .torrent, and must never be able to
// point the daemon at a local file (see runtime.ts's allowTorrentPath).
export async function magnetFromTorrentBytes(bytes: Uint8Array): Promise<ParsedMagnet | null> {
  try {
    if (bytes.length === 0 || bytes.length > MAX_TORRENT_BYTES) return null;
    return await readParsed(bytes);
  } catch {
    return null;
  }
}

export async function magnetFromTorrentFile(path: string): Promise<ParsedMagnet | null> {
  try {
    const stat = await fs.stat(path);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_TORRENT_BYTES) return null;
    const buf = await fs.readFile(path);
    return await readParsed(new Uint8Array(buf));
  } catch {
    return null;
  }
}

async function readParsed(bytes: Uint8Array): Promise<ParsedMagnet | null> {
    const parsed = await parseTorrent(bytes);
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
}
