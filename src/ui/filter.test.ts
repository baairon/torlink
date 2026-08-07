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
    expect(filterResults(list, false, "ubuntu 24").map(x => x.infoHash)).toEqual(["a", "b", "d"]);
  });

  it("filters by size with comparison operators", () => {
    const list = [
      r({ infoHash: "a", sizeBytes: 1000 }),
      r({ infoHash: "b", sizeBytes: 2000 }),
      r({ infoHash: "c", sizeBytes: 3000 }),
    ];
    expect(filterResults(list, false, "size:>1.5kb").map(x => x.infoHash)).toEqual(["b", "c"]);
    expect(filterResults(list, false, "size:<2500b").map(x => x.infoHash)).toEqual(["a", "b"]);
    expect(filterResults(list, false, "size:2kb").map(x => x.infoHash)).toEqual(["b"]);
  });

  it("filters by seeders and leechers", () => {
    const list = [
      r({ infoHash: "a", seeders: 10, leechers: 50 }),
      r({ infoHash: "b", seeders: 100, leechers: 2 }),
    ];
    expect(filterResults(list, false, "seeders:>50").map(x => x.infoHash)).toEqual(["b"]);
    expect(filterResults(list, false, "leechers:>10").map(x => x.infoHash)).toEqual(["a"]);
    expect(filterResults(list, false, "seed:<50 leech:>10").map(x => x.infoHash)).toEqual(["a"]);
  });

  it("filters by source using substring", () => {
    const list = [
      r({ infoHash: "a", source: "yts" }),
      r({ infoHash: "b", source: "fitgirl" }),
      r({ infoHash: "c", source: "x1337-movies" }),
    ];
    expect(filterResults(list, false, "source:fit").map(x => x.infoHash)).toEqual(["b"]);
    expect(filterResults(list, false, "src:yts").map(x => x.infoHash)).toEqual(["a"]);
  });

  it("combines text matching and property filters", () => {
    const list = [
      r({ infoHash: "a", name: "ubuntu 24", sizeBytes: 1000 }),
      r({ infoHash: "b", name: "ubuntu 22", sizeBytes: 3000 }),
      r({ infoHash: "c", name: "debian", sizeBytes: 5000 }),
    ];
    expect(filterResults(list, false, "ubuntu size:>2kb").map(x => x.infoHash)).toEqual(["b"]);
  });
});
