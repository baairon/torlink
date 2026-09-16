import { describe, expect, it } from "vitest";
import { rankSearchResults } from "./search-rank";

const opts = { maxSizeBytes: 6 * 1024 ** 3 };

describe("rankSearchResults", () => {
  it("prefers an exact title match over a partial unrelated match", () => {
    const ranked = rankSearchResults(
      "The Example Movie",
      [
        { infoHash: "a", title: "The.Example.Movie.2025.1080p", seeders: 20, sizeBytes: 2e9, torrentUrl: "a" },
        { infoHash: "b", title: "Example.Movie.Collection", seeders: 999, sizeBytes: 2e9, torrentUrl: "b" },
      ],
      opts,
    );

    expect(ranked[0]?.title).toBe("The.Example.Movie.2025.1080p");
  });

  it("normalizes dots, hyphens, and underscores", () => {
    const ranked = rankSearchResults(
      "Spider Man No Way Home",
      [
        { infoHash: "a", title: "Spider-Man.No_Way_Home.2021.1080p", seeders: 50, sizeBytes: 3e9, torrentUrl: "a" },
      ],
      opts,
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.title).toContain("Spider-Man.No_Way_Home");
  });

  it("> 6 GB results are excluded", () => {
    const ranked = rankSearchResults(
      "Big Movie",
      [
        { infoHash: "a", title: "Big.Movie.7GB", seeders: 999, sizeBytes: 7 * 1024 ** 3, torrentUrl: "a" },
        { infoHash: "b", title: "Big.Movie.5GB", seeders: 100, sizeBytes: 5 * 1024 ** 3, torrentUrl: "b" },
      ],
      opts,
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.sizeBytes).toBe(5 * 1024 ** 3);
  });

  it("prefers higher seeder counts", () => {
    const ranked = rankSearchResults(
      "Example Movie",
      [
        { infoHash: "a", title: "Example.Movie.1080p", seeders: 20, sizeBytes: 2e9, torrentUrl: "a" },
        { infoHash: "b", title: "Example.Movie.720p", seeders: 100, sizeBytes: 1e9, torrentUrl: "b" },
      ],
      opts,
    );

    expect(ranked[0]?.seeders).toBe(100);
  });

  it("uses file size as a tie breaker when seeders are similar", () => {
    const ranked = rankSearchResults(
      "Example Movie",
      [
        { infoHash: "a", title: "Example.Movie.Small", seeders: 50, sizeBytes: 1e9, torrentUrl: "a" },
        { infoHash: "b", title: "Example.Movie.Big", seeders: 50, sizeBytes: 3e9, torrentUrl: "b" },
      ],
      opts,
    );

    expect(ranked[0]?.sizeBytes).toBe(3e9);
  });

  it("returns no valid results when nothing matches cleanly", () => {
    const ranked = rankSearchResults(
      "The Example Movie",
      [
        { infoHash: "a", title: "Another Film", seeders: 500, sizeBytes: 2e9, torrentUrl: "a" },
        { infoHash: "b", title: "Example Movie Sample Pack", seeders: 5, sizeBytes: 0, torrentUrl: "b" },
      ],
      opts,
    );

    expect(ranked).toHaveLength(0);
  });
});
