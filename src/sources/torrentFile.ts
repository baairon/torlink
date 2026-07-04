import { promises as fs } from "node:fs";
import parseTorrent from "parse-torrent";
import { buildMagnet, type ParsedMagnet } from "./magnet";

export async function magnetFromTorrentFile(path: string): Promise<ParsedMagnet | null> {
  try {
    const buf = await fs.readFile(path);
    const parsed = await parseTorrent(new Uint8Array(buf));
    const infoHash = parsed?.infoHash?.toLowerCase();
    if (!infoHash) return null;
    const name = parsed.name || infoHash;
    return { infoHash, name, magnet: buildMagnet(infoHash, name) };
  } catch {
    return null;
  }
}
