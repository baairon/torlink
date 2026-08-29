// Headless seed mode: make a torrent out of files you already have, and serve
// them to the swarm.
//
// Every other way into torlink starts from a torrent somebody else made. This
// is the origin case, and it is the one thing the client could not do: search
// finds torrents, the watch folder is handed them, the API is posted them —
// none of that helps when the content is yours and no torrent for it exists.
//
// The order matters and is the whole trick. Create the .torrent first, write it
// beside the data, then add it BY PATH. Adding the magnet instead would be
// correct and useless: a magnet carries no piece hashes, so the client has to
// fetch metadata from the swarm before it can verify anything — and the swarm
// for a torrent nobody has ever seen has no one in it to fetch from. It would
// sit at zero per cent forever, seeding data that is already on the disk under
// it. Handed the .torrent, it verifies locally and is seeding in seconds.

import path from "node:path";

import { loadConfig } from "../config/config";
import { createTorrentFor } from "../download/create";
import { saveTorrentMeta } from "../download/persist";
import { startRuntime, addInput } from "./runtime";
import { startSeedReaper } from "./seed-reaper";

export interface SeedOptions {
  seedTimeMs?: number;
  deleteFiles?: boolean;
}

function log(message: string): void {
  console.log(`[torlnk seed] ${new Date().toISOString()} ${message}`);
}

// The directory a client must be pointed at for existing data to verify.
//
// A torrent names its own top-level entry, so seeding /srv/media/album means
// the client's download directory has to be /srv/media — point it at the album
// itself and it looks for /srv/media/album/album, finds nothing, and downloads
// a complete copy next to the one already there.
export function seedRootFor(target: string): string {
  return path.dirname(path.resolve(target));
}

export async function runSeed(target: string, options: SeedOptions = {}): Promise<void> {
  const root = seedRootFor(target);
  const config = await loadConfig();

  log(`hashing ${path.resolve(target)}`);
  const created = await createTorrentFor(target, config.trackers);
  log(`wrote ${created.torrentPath}`);

  // Store the metadata where the queue looks for it BEFORE adding. This is the
  // step that makes the difference between seeding and pretending to: with it,
  // the engine is handed piece hashes and verifies the files already on disk;
  // without it, it gets a bare magnet and waits for a swarm that has nobody in
  // it to send back the metadata for a torrent that has never existed.
  await saveTorrentMeta(created.infoHash, created.torrentFile);

  // The download dir is the content's parent, not the configured one: this
  // torrent's data is already where it is, and moving it is not on offer.
  const runtime = await startRuntime(root);
  const outcome = await addInput(runtime, created.torrentPath, { allowTorrentPath: true });
  if (outcome === "invalid") throw new Error(`could not seed ${created.torrentPath}`);
  if (outcome === "duplicate") log("already in the queue — leaving it alone");

  if (options.seedTimeMs) {
    startSeedReaper(runtime.queue, options.seedTimeMs, { deleteFiles: options.deleteFiles });
  }

  // The magnet on its own line and nothing else on it, so `torlnk seed x | tail
  // -1` is a usable thing to write in a script.
  log(`seeding ${created.name} (${created.infoHash}) from ${root}`);
  console.log(created.magnet);
}
