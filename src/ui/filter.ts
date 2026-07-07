import { getSource } from "../sources/registry";
import type { TorrentResult } from "../sources/types";

export function filterResults(
  list: TorrentResult[],
  hideDead: boolean,
): TorrentResult[] {
  if (!hideDead) return list;
  // Sources without swarm data report seeders: 0 for everything (unknown, not
  // dead), so the filter only judges rows whose source actually reports health.
  return list.filter((r) => r.seeders > 0 || !getSource(r.source).reportsHealth);
}
