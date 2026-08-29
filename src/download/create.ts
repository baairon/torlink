// Making a torrent out of a path you already have.
//
// Everything else in torlink starts from a magnet or a .torrent that someone
// else made: search finds one, the watch folder is handed one, the API is
// posted one. This is the other direction — you have the files, and you want a
// torrent of them — and it is the one thing the client could not do.
//
// It produces both halves on purpose. The .torrent is what lets torlink (and
// any other client) verify the data already on disk and go straight to seeding
// instead of fetching metadata from a swarm that has no seeds yet; the magnet
// is what you actually paste somewhere.

import createTorrent from "create-torrent";
import { promises as fs } from "node:fs";
import path from "node:path";

import { magnetFromTorrentBytes } from "../sources/torrentFile";
import type { ParsedMagnet } from "../sources/magnet";

export interface CreatedTorrent extends ParsedMagnet {
  // The bencoded .torrent, and where it was written.
  torrentFile: Uint8Array;
  torrentPath: string;
  // The directory a client must be pointed at for the existing data to verify:
  // the PARENT of the path, because a torrent names its own top-level entry.
  contentDir: string;
}

// A torrent with no announce list is a DHT-only torrent, which works but is
// slower to be found and invisible to anything watching a tracker. The caller's
// configured trackers are used when it has some; create-torrent supplies its
// own defaults otherwise.
export function torrentOptions(announce: string[]): { announce?: string[] } {
  return announce.length > 0 ? { announce } : {};
}

// create-torrent is callback-shaped and hashes every piece, so this is the one
// genuinely slow step: a large directory is read end to end.
export function buildTorrent(target: string, announce: string[]): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    createTorrent(target, torrentOptions(announce), (err: Error | null, torrent: Uint8Array) => {
      if (err) reject(err);
      else resolve(torrent);
    });
  });
}

// Where the .torrent goes: beside the data, named after it. Next to the content
// rather than in a config directory because the two belong together — moving
// the files and leaving the torrent behind is how you end up with a magnet
// nobody can serve.
export function torrentPathFor(target: string): string {
  const full = path.resolve(target);
  return path.join(path.dirname(full), `${path.basename(full)}.torrent`);
}

// Create a torrent for `target`, write it beside the data, and return both the
// magnet and everything a caller needs to seed it. Throws on a path that cannot
// be read: unlike the watch folder, this is a direct instruction from an
// operator, and failing quietly would leave them with no torrent and no reason.
export async function createTorrentFor(
  target: string,
  announce: string[] = [],
): Promise<CreatedTorrent> {
  const full = path.resolve(target);
  await fs.stat(full);

  const torrentFile = await buildTorrent(full, announce);
  const parsed = await magnetFromTorrentBytes(torrentFile);
  if (!parsed) throw new Error("created a torrent that could not be parsed back");

  const torrentPath = torrentPathFor(full);
  await fs.writeFile(torrentPath, torrentFile);

  return { ...parsed, torrentFile, torrentPath, contentDir: path.dirname(full) };
}
