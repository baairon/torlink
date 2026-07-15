import { describe, it, expect } from "vitest";
import { dedupe, orderByHealth } from "./search";
import type { TorrentResult } from "./types";

const r = (over: Partial<TorrentResult>): TorrentResult => ({
  infoHash: "h",
  name: "Example",
  sizeBytes: 1000,
  seeders: 0,
  leechers: 0,
  source: "yts",
  magnet: "magnet:?xt=urn:btih:h",
  ...over,
});

describe("dedupe", () => {
  it("keeps the highest-seeder copy of each info hash", () => {
    const out = dedupe([
      r({ infoHash: "a", seeders: 5 }),
      r({ infoHash: "a", seeders: 20 }),
      r({ infoHash: "b", seeders: 3 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((x) => x.infoHash === "a")!.seeders).toBe(20);
  });
});

describe("orderByHealth", () => {
  it("sorts by seeders desc, then newer first", () => {
    const out = orderByHealth([
      r({ infoHash: "a", seeders: 1, added: 100 }),
      r({ infoHash: "b", seeders: 9, added: 1 }),
      r({ infoHash: "c", seeders: 9, added: 50 }),
    ]);
    expect(out.map((x) => x.infoHash)).toEqual(["c", "b", "a"]);
  });
});
