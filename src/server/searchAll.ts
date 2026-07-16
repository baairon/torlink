import { cachedSearch } from "../sources/cache";
import { getSource, SOURCES } from "../sources/registry";
import type { SourceGroup, TorrentResult } from "../sources/types";
import { filterResults } from "../ui/lib/filter";
import { sortResults, type Sort, type SortDir, type SortField } from "../ui/lib/sort";

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

export type SearchSort = Sort | "name:asc" | "name:desc";

export interface SearchAllOptions {
  signal?: AbortSignal;
  group?: SourceGroup;
  hideDead?: boolean;
  sort?: SearchSort | null;
}

const SORT_FIELDS = new Set<SortField>(["size", "seeders", "source", "added"]);

/** Parse `seeders`, `seeders:desc`, `size:asc`, `name:desc`, or empty → null (default). */
export function parseSearchSort(raw: string | null | undefined): SearchSort | null {
  if (!raw?.trim()) return null;
  const t = raw.trim().toLowerCase();
  if (t === "none" || t === "default") return "none";
  const [fieldRaw, dirRaw] = t.split(":");
  const dir: SortDir = dirRaw === "asc" ? "asc" : "desc";
  if (fieldRaw === "name") return dir === "asc" ? "name:asc" : "name:desc";
  if (fieldRaw && SORT_FIELDS.has(fieldRaw as SortField)) {
    return { field: fieldRaw as SortField, dir };
  }
  return null;
}

function applySort(list: TorrentResult[], sort: SearchSort | null | undefined): TorrentResult[] {
  if (!sort || sort === "none") {
    return list.slice().sort((a, b) => b.seeders - a.seeders || a.name.localeCompare(b.name));
  }
  if (sort === "name:asc" || sort === "name:desc") {
    const mul = sort === "name:asc" ? 1 : -1;
    return list.slice().sort((a, b) => mul * a.name.localeCompare(b.name) || b.seeders - a.seeders);
  }
  return sortResults(list, sort);
}

/** Fan-out to every registered source (same idea as the TUI concurrent search). */
export async function searchAll(
  query: string,
  opts: SearchAllOptions = {},
): Promise<SearchAllResult> {
  const q = normalizeSearchQuery(query);
  if (!q) return { query: query.trim(), results: [], errors: [] };

  const settled = await Promise.allSettled(
    SOURCES.map(async (source) => {
      const rows = await cachedSearch(source, q, { signal: opts.signal });
      return { sourceId: source.id, rows };
    }),
  );

  let results: TorrentResult[] = [];
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

  if (opts.group) {
    results = results.filter((r) => getSource(r.source).group === opts.group);
  }
  results = filterResults(results, Boolean(opts.hideDead));
  results = applySort(results, opts.sort ?? null);

  return { query: q, results, errors };
}
