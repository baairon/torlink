import { mergeMagnetTrackers } from "../sources/magnet";
import type { TorrentResult } from "../sources/types";

// The same torrent reaches the list from several sources at once, and only one
// row should survive. The healthiest row still wins — its seeder count is the
// one worth showing — but the rows it beats are folded into it instead of being
// dropped:
//
//   - their announce lists. 1337x and EZTV hand back the torrent's own
//     trackers, while rows built by buildMagnet() carry only torlink's public
//     defaults, so keeping the higher-seeder row alone can trade a working
//     announce list for a generic one. Same loss #146 fixed for a .torrent
//     file's own trackers.
//   - numFiles, added and imdbId, but only where the winner has none. A field
//     the winner never reported is a gap, not a decision — and an imdbId is
//     worth more than a blank column, since losing it sends the metadata
//     lookup back to guessing a title from the release name.
//
// Everything else stays the winner's, including its magnet URI byte for byte.
function merge(a: TorrentResult, b: TorrentResult): TorrentResult {
  const [win, lost] = b.seeders > a.seeders ? [b, a] : [a, b];
  return {
    ...win,
    magnet: mergeMagnetTrackers(win.magnet, [lost.magnet]),
    numFiles: win.numFiles ?? lost.numFiles,
    added: win.added ?? lost.added,
    imdbId: win.imdbId ?? lost.imdbId,
  };
}

export function dedupeResults(list: TorrentResult[]): TorrentResult[] {
  const byHash = new Map<string, TorrentResult>();
  for (const r of list) {
    const existing = byHash.get(r.infoHash);
    byHash.set(r.infoHash, existing ? merge(existing, r) : r);
  }
  return [...byHash.values()];
}
