import { describe, it, expect } from "vitest";
import { CATEGORIES, parseSourceGroup } from "../../src/sources/categories";
import { filterResults } from "../../src/ui/lib/filter";
import { parseSearchSort } from "../../src/server/searchAll";
import type { TorrentResult } from "../../src/sources/types";

describe("categories", () => {
  it("maps category keys and group labels", () => {
    expect(parseSourceGroup("Movies")).toBe("Movies");
    expect(parseSourceGroup("movies")).toBe("Movies");
    expect(parseSourceGroup("nope")).toBeUndefined();
    expect(CATEGORIES.map((c) => c.key)).toEqual(["all", "games", "movies", "tv", "anime"]);
  });
});

describe("parseSearchSort", () => {
  it("parses sort query values", () => {
    expect(parseSearchSort(null)).toBeNull();
    expect(parseSearchSort("seeders:asc")).toEqual({ field: "seeders", dir: "asc" });
    expect(parseSearchSort("size")).toEqual({ field: "size", dir: "desc" });
    expect(parseSearchSort("name:asc")).toBe("name:asc");
    expect(parseSearchSort("none")).toBe("none");
    expect(parseSearchSort("bogus")).toBeNull();
  });
});

describe("filterResults hideDead", () => {
  const row = (partial: Partial<TorrentResult> & Pick<TorrentResult, "source" | "seeders">): TorrentResult => ({
    infoHash: "a".repeat(40),
    name: "x",
    sizeBytes: 1,
    leechers: 0,
    magnet: "magnet:?xt=urn:btih:" + "a".repeat(40),
    ...partial,
  });

  it("drops zero-seed rows only for sources that report health", () => {
    const list = [
      row({ source: "yts", seeders: 0 }),
      row({ source: "yts", seeders: 5, infoHash: "b".repeat(40) }),
      row({ source: "fitgirl", seeders: 0, infoHash: "c".repeat(40) }),
    ];
    const alive = filterResults(list, true);
    expect(alive.map((r) => r.infoHash)).toEqual(["b".repeat(40), "c".repeat(40)]);
  });
});
