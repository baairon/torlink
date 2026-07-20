import { describe, it, expect, vi } from "vitest";
import { cachedSearch } from "./cache";
import type { Source, TorrentResult } from "./types";

function fakeSource(results: TorrentResult[] = []): Source {
  return {
    id: "nyaa",
    label: "Nyaa",
    homepage: "https://nyaa.si",
    reportsHealth: true,
    search: vi.fn(async () => results),
  };
}

describe("cachedSearch", () => {
  it("returns cached results for the same source+query within TTL", async () => {
    const src = fakeSource([{ infoHash: "aa".repeat(20), name: "a", sizeBytes: 0, seeders: 0, leechers: 0, source: "nyaa", magnet: "magnet:?xt=urn:btih:aa" }]);
    const r1 = await cachedSearch(src, "test");
    const r2 = await cachedSearch(src, "test");
    expect(r1).toBe(r2);
    expect(src.search).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent identical requests into one call", async () => {
    const src = fakeSource([{ infoHash: "bb".repeat(20), name: "b", sizeBytes: 0, seeders: 0, leechers: 0, source: "nyaa", magnet: "magnet:?xt=urn:btih:bb" }]);
    const [r1, r2, r3] = await Promise.all([
      cachedSearch(src, "concurrent"),
      cachedSearch(src, "concurrent"),
      cachedSearch(src, "concurrent"),
    ]);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
    expect(src.search).toHaveBeenCalledTimes(1);
  });
});
