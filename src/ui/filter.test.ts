import { describe, it, expect } from "vitest";
import { filterResults } from "./filter";
import type { SourceId, TorrentResult } from "../sources/types";

function r(p: Partial<TorrentResult> & { infoHash: string }): TorrentResult {
  return {
    name: p.name ?? p.infoHash,
    sizeBytes: p.sizeBytes ?? 0,
    seeders: p.seeders ?? 0,
    leechers: p.leechers ?? 0,
    source: (p.source ?? "yts") as SourceId,
    magnet: p.magnet ?? `magnet:?xt=urn:btih:${p.infoHash}`,
    ...p,
  };
}

describe("filterResults", () => {
  it("passes everything through when hideDead is off", () => {
    const list = [r({ infoHash: "a", seeders: 0 }), r({ infoHash: "b", seeders: 5 })];
    expect(filterResults(list, false)).toEqual(list);
  });

  it("drops zero-seeder results when hideDead is on", () => {
    const list = [
      r({ infoHash: "a", seeders: 0 }),
      r({ infoHash: "b", seeders: 1 }),
      r({ infoHash: "c", seeders: 0 }),
    ];
    expect(filterResults(list, true).map((x) => x.infoHash)).toEqual(["b"]);
  });

  it("keeps zero-seeder rows from sources that report no health data", () => {
    const list = [
      r({ infoHash: "a", seeders: 0, source: "fitgirl" }),
      r({ infoHash: "b", seeders: 0 }),
      r({ infoHash: "c", seeders: 0, source: "subsplease" }),
      r({ infoHash: "d", seeders: 3 }),
    ];
    expect(filterResults(list, true).map((x) => x.infoHash)).toEqual(["a", "c", "d"]);
  });

  it("does not mutate the input array", () => {
    const list = [r({ infoHash: "a", seeders: 0 }), r({ infoHash: "b", seeders: 2 })];
    const before = list.map((x) => x.infoHash);
    filterResults(list, true);
    expect(list.map((x) => x.infoHash)).toEqual(before);
  });

  it("filters by text matching all tokens and ranks exact matches higher", () => {
    const list = [
      r({ infoHash: "a", name: "ubuntu 24 desktop" }),
      r({ infoHash: "b", name: "ubuntu desktop 24.04" }),
      r({ infoHash: "c", name: "debian 12" }),
      r({ infoHash: "d", name: "24 ubuntu desktop" }),
    ];
    // "ubuntu 24" -> 
    // a: exact substring "ubuntu 24" (score 60)
    // b: "ubuntu" before "24" (score 30)
    // d: "24" before "ubuntu" (out of order, score 10)
    // c: no match
    expect(filterResults(list, false, "ubuntu 24").map(x => x.infoHash)).toEqual(["a", "b", "d"]);
  });
});
