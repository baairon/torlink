import type { SearchOptions, Source, TorrentResult } from "./types";

const TTL_MS = 5 * 60 * 1000;

// A search fills one entry per source, so this is the last ten searches --
// more history than a five-minute TTL can put to use. Nothing evicted anything
// before, so the map only ever grew, holding result lists the UI had long since
// replaced: 200 distinct searches across the ten sources retained about 80 MB.
const MAX_ENTRIES = 100;

interface Entry {
  at: number;
  results: TorrentResult[];
}

const cache = new Map<string, Entry>();

function key(sourceId: string, query: string): string {
  return `${sourceId}::${query.trim().toLowerCase()}`;
}

export async function cachedSearch(
  source: Source,
  query: string,
  opts: SearchOptions = {},
): Promise<TorrentResult[]> {
  const k = key(source.id, query);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.results;

  const results = await source.search(query, opts);
  // Re-inserting rather than overwriting keeps the map's iteration order equal
  // to fetch order, so the entry that gives way below is always the oldest.
  cache.delete(k);
  cache.set(k, { at: Date.now(), results });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return results;
}
