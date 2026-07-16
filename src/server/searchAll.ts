import { cachedSearch } from "../sources/cache";
import { SOURCES } from "../sources/registry";
import type { TorrentResult } from "../sources/types";

const MAX_QUERY_LEN = 200;

export function normalizeSearchQuery(raw: string): string | null {
  const q = raw.trim();
  if (!q || q.length > MAX_QUERY_LEN) return null;
  return q;
}

export interface SearchAllResult {
  query: string;
  results: TorrentResult[];
  errors: { source: string; message: string }[];
}

/** Fan-out to every registered source (same idea as the TUI concurrent search). */
export async function searchAll(
  query: string,
  opts: { signal?: AbortSignal } = {},
): Promise<SearchAllResult> {
  const q = normalizeSearchQuery(query);
  if (!q) return { query: query.trim(), results: [], errors: [] };

  const settled = await Promise.allSettled(
    SOURCES.map(async (source) => {
      const rows = await cachedSearch(source, q, { signal: opts.signal });
      return { sourceId: source.id, rows };
    }),
  );

  const results: TorrentResult[] = [];
  const errors: { source: string; message: string }[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < settled.length; i++) {
    const source = SOURCES[i]!;
    const item = settled[i]!;
    if (item.status === "rejected") {
      const message = item.reason instanceof Error ? item.reason.message : String(item.reason);
      errors.push({ source: source.id, message });
      continue;
    }
    for (const row of item.value.rows) {
      const key = `${row.infoHash}::${row.source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(row);
    }
  }

  results.sort((a, b) => b.seeders - a.seeders || a.name.localeCompare(b.name));
  return { query: q, results, errors };
}
