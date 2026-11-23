import { describe, expect, it, vi } from "vitest";
import { searchWithFallback, matchesTitle } from "./search";
import type { Source, TorrentResult } from "./types";

function result(name: string): TorrentResult {
  return { name, infoHash: "a".repeat(40), source: "yts", sizeBytes: 0,
    seeders: 1, leechers: 0, magnet: "magnet:?xt=urn:btih:test" };
}
function source(search: Source["search"]): Source {
  return { id: "yts", label: "YTS", homepage: "https://example.org", reportsHealth: true, search };
}

describe("matchesTitle", () => {
  it.each([
    ["spider man", "Spider-Man (2002) [1080p]"],
    ["baldurs gate", "Baldur’s Gate 3"],
    ["pokemon", "Pokémon"],
    ["elden rign", "Elden Ring"],
    ["night livng dead", "Night of the Living Dead"],
    ["ring elden", "Elden Ring"],
    ["elden rin", "Elden Ring"],
    ["super tux kart", "SuperTuxKart"],
    ["the matrix", "The Matrix"],
  ])("matches %s against %s", (query, title) => {
    expect(matchesTitle(query, title)).toBe(true);
  });
  it.each([
    ["elden ring", "Ring of Pain"],
    ["dune 2", "Dune (2021)"],
    ["dune", "Duke Nukem"],
    ["it", "Little Nightmares"],
    ["---", "Anything"],
  ])("rejects %s against %s", (query, title) => {
    expect(matchesTitle(query, title)).toBe(false);
  });
});

describe("searchWithFallback", () => {
  it("leaves successful and browse searches alone", async () => {
    const rows = [result("The Matrix")];
    const search = vi.fn().mockResolvedValue(rows);
    expect(await searchWithFallback(source(search), "matrix")).toBe(rows);
    search.mockResolvedValue([]);
    expect(await searchWithFallback(source(search), "")).toEqual([]);
    expect(search.mock.calls.map(([q]) => q)).toEqual(["matrix", ""]);
  });
  it("normalizes punctuation before broadening", async () => {
    const rows = [result("Spider-Man")];
    const search = vi.fn(async (q: string) => q === "spider man" ? rows : []);
    expect(await searchWithFallback(source(search), "Spider-Man")).toEqual(rows);
    expect(search.mock.calls.map(([q]) => q)).toEqual(["Spider-Man", "spider man"]);
  });
  it("recovers a typo from an anchor search and rejects unrelated candidates", async () => {
    const match = result("Elden Ring");
    const search = vi.fn(async (q: string) => q === "elden" ? [result("Elden Quest"), match] : []);
    expect(await searchWithFallback(source(search), "elden rign")).toEqual([match]);
    expect(search.mock.calls.map(([q]) => q)).toEqual(["elden rign", "elden"]);
  });
  it("tries a second anchor when the first term is misspelled", async () => {
    const match = result("Elden Ring");
    const search = vi.fn(async (q: string) => q === "ring" ? [match] : []);
    expect(await searchWithFallback(source(search), "eldne ring")).toEqual([match]);
    expect(search.mock.calls.map(([q]) => q)).toEqual(["eldne ring", "eldne", "ring"]);
  });
  it("bounds empty searches and avoids short or numeric anchor queries", async () => {
    const search = vi.fn(async () => []);
    await searchWithFallback(source(search), "the long missing title 2");
    expect(search.mock.calls.length).toBeLessThanOrEqual(4);
    search.mockClear();
    await searchWithFallback(source(search), "it 2");
    expect(search).toHaveBeenCalledTimes(1);
  });
  it("preserves initial errors and tolerates optional fallback failures", async () => {
    const search = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(searchWithFallback(source(search), "elden ring")).rejects.toThrow("offline");
    expect(search).toHaveBeenCalledTimes(1);
    search.mockReset().mockResolvedValueOnce([]).mockRejectedValue(new Error("offline"));
    expect(await searchWithFallback(source(search), "elden ring")).toEqual([]);
  });
  it("passes cancellation through and starts no fallback after an abort", async () => {
    const controller = new AbortController();
    const search = vi.fn(async () => { controller.abort(); return []; });
    await searchWithFallback(source(search), "elden ring", { signal: controller.signal });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]).toEqual(["elden ring", { signal: controller.signal }]);
  });
});
