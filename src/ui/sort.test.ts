import { describe, it, expect } from "vitest";
import { nextSort, sortResults, sortArrow, SORT_CYCLE } from "./sort";
import type { Sort } from "./sort";
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

const ids = (list: TorrentResult[]): string[] => list.map((x) => x.infoHash);

describe("nextSort", () => {
  it("cycles through 7 states: none -> size asc/desc -> seeders asc/desc -> source asc/desc -> none", () => {
    const seq: Sort[] = [];
    let s: Sort = "none";
    for (let i = 0; i < 7; i++) {
      s = nextSort(s);
      seq.push(s);
    }
    expect(seq).toEqual([
      { field: "size", dir: "asc" },
      { field: "size", dir: "desc" },
      { field: "seeders", dir: "asc" },
      { field: "seeders", dir: "desc" },
      { field: "source", dir: "asc" },
      { field: "source", dir: "desc" },
      "none",
    ]);
  });

  it("SORT_CYCLE has exactly 7 states starting with none", () => {
    expect(SORT_CYCLE).toHaveLength(7);
    expect(SORT_CYCLE[0]).toBe("none");
  });
});

describe("sortArrow", () => {
  it("points up for asc and down for desc", () => {
    expect(sortArrow("asc")).toBe("▴");
    expect(sortArrow("desc")).toBe("▾");
  });
});

describe("sortResults", () => {
  it("none preserves the original arrival order", () => {
    const list = [
      r({ infoHash: "a", sizeBytes: 1, seeders: 1 }),
      r({ infoHash: "b", sizeBytes: 9, seeders: 9 }),
      r({ infoHash: "c", sizeBytes: 5, seeders: 5 }),
    ];
    expect(ids(sortResults(list, "none"))).toEqual(["a", "b", "c"]);
  });

  it("size asc: smallest first", () => {
    const list = [
      r({ infoHash: "a", sizeBytes: 500 }),
      r({ infoHash: "b", sizeBytes: 100 }),
      r({ infoHash: "c", sizeBytes: 900 }),
    ];
    expect(ids(sortResults(list, { field: "size", dir: "asc" }))).toEqual(["b", "a", "c"]);
  });

  it("size desc: largest first", () => {
    const list = [
      r({ infoHash: "a", sizeBytes: 500 }),
      r({ infoHash: "b", sizeBytes: 100 }),
      r({ infoHash: "c", sizeBytes: 900 }),
    ];
    expect(ids(sortResults(list, { field: "size", dir: "desc" }))).toEqual(["c", "a", "b"]);
  });

  it("seeders asc: fewest first", () => {
    const list = [
      r({ infoHash: "a", seeders: 50 }),
      r({ infoHash: "b", seeders: 5 }),
      r({ infoHash: "c", seeders: 90 }),
    ];
    expect(ids(sortResults(list, { field: "seeders", dir: "asc" }))).toEqual(["b", "a", "c"]);
  });

  it("seeders desc: most first", () => {
    const list = [
      r({ infoHash: "a", seeders: 50 }),
      r({ infoHash: "b", seeders: 5 }),
      r({ infoHash: "c", seeders: 90 }),
    ];
    expect(ids(sortResults(list, { field: "seeders", dir: "desc" }))).toEqual(["c", "a", "b"]);
  });

  it("source asc: A->Z by source id", () => {
    const list = [
      r({ infoHash: "a", source: "yts" }),
      r({ infoHash: "b", source: "eztv" }),
      r({ infoHash: "c", source: "nyaa" }),
    ];
    expect(ids(sortResults(list, { field: "source", dir: "asc" }))).toEqual(["b", "c", "a"]);
  });

  it("source desc: Z->A by source id", () => {
    const list = [
      r({ infoHash: "a", source: "eztv" }),
      r({ infoHash: "b", source: "yts" }),
      r({ infoHash: "c", source: "nyaa" }),
    ];
    expect(ids(sortResults(list, { field: "source", dir: "desc" }))).toEqual(["b", "c", "a"]);
  });

  it("does not mutate the input array", () => {
    const list = [
      r({ infoHash: "a", sizeBytes: 1 }),
      r({ infoHash: "b", sizeBytes: 2 }),
    ];
    const before = ids(list);
    sortResults(list, { field: "size", dir: "asc" });
    expect(ids(list)).toEqual(before);
  });
});
