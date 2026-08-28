import type { TorrentResult } from "./types";

export function dedupe(list: TorrentResult[]): TorrentResult[] {
  const byHash = new Map<string, TorrentResult>();
  for (const result of list) {
    const existing = byHash.get(result.infoHash);
    if (!existing || result.seeders > existing.seeders) byHash.set(result.infoHash, result);
  }
  return [...byHash.values()];
}

// torlink's default ordering: healthiest first, then newest.
export function defaultOrder(list: TorrentResult[]): TorrentResult[] {
  return list.sort((a, b) => b.seeders - a.seeders || (b.added ?? 0) - (a.added ?? 0));
}
