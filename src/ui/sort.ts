import type { TorrentResult } from "../sources/types";

export type SortField = "size" | "seeders" | "source";
export type SortDir = "asc" | "desc";
export interface SortState {
  field: SortField;
  dir: SortDir;
}

/** A sort selection, or "none" for the untouched/default order. */
export type Sort = SortState | "none";

/**
 * The order the `s` key cycles through: start untouched, then each field
 * ascending then descending, then back to untouched.
 */
export const SORT_CYCLE: Sort[] = [
  "none",
  { field: "size", dir: "asc" },
  { field: "size", dir: "desc" },
  { field: "seeders", dir: "asc" },
  { field: "seeders", dir: "desc" },
  { field: "source", dir: "asc" },
  { field: "source", dir: "desc" },
];

function sameSort(a: Sort, b: Sort): boolean {
  if (a === "none" || b === "none") return a === b;
  return a.field === b.field && a.dir === b.dir;
}

export function nextSort(current: Sort): Sort {
  const i = SORT_CYCLE.findIndex((s) => sameSort(s, current));
  return SORT_CYCLE[(i + 1) % SORT_CYCLE.length]!;
}

export function sortArrow(dir: SortDir): string {
  return dir === "asc" ? "▴" : "▾";
}

export function sortLabel(sort: Sort): string {
  if (sort === "none") return "default";
  return `${sort.field} ${sortArrow(sort.dir)}`;
}

export function sortResults(list: TorrentResult[], sort: Sort): TorrentResult[] {
  const arr = list.slice();
  if (sort === "none") return arr;
  const mul = sort.dir === "asc" ? 1 : -1;
  switch (sort.field) {
    case "size":
      arr.sort((a, b) => mul * (a.sizeBytes - b.sizeBytes) || b.seeders - a.seeders);
      break;
    case "seeders":
      arr.sort((a, b) => mul * (a.seeders - b.seeders) || (b.added ?? 0) - (a.added ?? 0));
      break;
    case "source":
      arr.sort((a, b) => mul * a.source.localeCompare(b.source) || b.seeders - a.seeders);
      break;
  }
  return arr;
}
