import type { SearchOptions, Source, TorrentResult } from "./types";

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 200;

interface Entry {
  at: number;
  results: TorrentResult[];
}

const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<TorrentResult[]>>();

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
  if (hit) cache.delete(k);

  const existing = pending.get(k);
  if (existing) return existing;

  const run = source
    .search(query, opts)
    .then((results) => {
      if (!opts.signal?.aborted) {
        cache.set(k, { at: Date.now(), results });
        if (cache.size > MAX_ENTRIES) {
          const oldest = cache.keys().next();
          if (!oldest.done) cache.delete(oldest.value);
        }
      }
      return results;
    })
    .finally(() => {
      pending.delete(k);
    });

  pending.set(k, run);
  return run;
}
