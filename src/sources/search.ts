import { SOURCES } from "./registry";
import { cachedSearch } from "./cache";
import type { SearchOptions, SourceGroup, TorrentResult } from "./types";

// Collapse duplicate torrents (same info hash from several sources), keeping the
// row with the most seeders, the healthiest report of the same swarm.
export function dedupe(list: TorrentResult[]): TorrentResult[] {
  const byHash = new Map<string, TorrentResult>();
  for (const r of list) {
    const existing = byHash.get(r.infoHash);
    if (!existing || r.seeders > existing.seeders) byHash.set(r.infoHash, r);
  }
  return [...byHash.values()];
}

// torlink's default ordering: healthiest first, newest as the tiebreak.
export function orderByHealth(list: TorrentResult[]): TorrentResult[] {
  return list.sort((a, b) => {
    if (b.seeders !== a.seeders) return b.seeders - a.seeders;
    return (b.added ?? 0) - (a.added ?? 0);
  });
}

// Search every source at once and return one merged, health-ordered list. The
// non-React sibling of useConcurrentSearch, for headless callers (the Discord
// bridge) that need results without a component tree. A source that throws is
// skipped, matching the TUI's fail-soft behaviour. Pass `group` to search only
// one category's sources (Games, Movies, TV, Anime), like the TUI's tabs.
export async function searchAll(
  query: string,
  opts: SearchOptions & { group?: SourceGroup } = {},
): Promise<TorrentResult[]> {
  const { group, ...searchOpts } = opts;
  const sources = group ? SOURCES.filter((s) => s.groups?.includes(group)) : SOURCES;
  const settled = await Promise.all(
    sources.map((s) => cachedSearch(s, query, searchOpts).catch(() => [] as TorrentResult[])),
  );
  return orderByHealth(dedupe(settled.flat()));
}
