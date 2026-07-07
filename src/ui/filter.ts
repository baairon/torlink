import type { TorrentResult } from "../sources/types";

export function filterResults(
  list: TorrentResult[],
  hideDead: boolean,
): TorrentResult[] {
  if (!hideDead) return list;
  return list.filter((r) => r.seeders > 0);
}
