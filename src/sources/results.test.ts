import { describe, expect, it } from "vitest";
import type { TorrentResult } from "./types";
import { dedupe, defaultOrder } from "./results";

function result(infoHash: string, seeders: number, added?: number): TorrentResult {
  return {
    infoHash,
    name: infoHash,
    source: "yts",
    sizeBytes: 1,
    seeders,
    leechers: 0,
    added,
    magnet: `magnet:?xt=urn:btih:${infoHash}`,
  };
}

describe("torrent result helpers", () => {
  it("deduplicates by info hash and keeps the result with more seeders", () => {
    const weaker = result("same", 4);
    const stronger = { ...result("same", 12), source: "tpb-movies" as const };

    expect(dedupe([weaker, stronger])).toEqual([stronger]);
    expect(dedupe([stronger, weaker])).toEqual([stronger]);
  });

  it("orders by seeders, then added time, descending", () => {
    const ordered = defaultOrder([
      result("few", 2, 300),
      result("older", 8, 100),
      result("newer", 8, 200),
      result("undated", 8),
    ]);

    expect(ordered.map(({ infoHash }) => infoHash)).toEqual(["newer", "older", "undated", "few"]);
  });
});
