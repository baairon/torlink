import { describe, it, expect } from "vitest";
import { tpbMusic } from "./piratebay";

describe("tpbMusic source", () => {
  it("is registered with the Music group and correct id", () => {
    expect(tpbMusic.group).toBe("Music");
    expect(tpbMusic.id).toBe("tpb-music");
    expect(tpbMusic.label).toBe("TPB");
  });

  it("empty query hits the precompiled top-100 audio endpoint", async () => {
    const fetched: string[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = ((url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      fetched.push(u);
      return Promise.resolve(
        new Response(JSON.stringify([]), { status: 200 }),
      );
    }) as typeof fetch;

    try {
      await tpbMusic.search("");
      expect(fetched[0]).toContain("data_top100_100");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("searches with a query via the apibay q.php endpoint", async () => {
    const fetched: string[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = ((url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      fetched.push(u);
      return Promise.resolve(
        new Response(JSON.stringify([]), { status: 200 }),
      );
    }) as typeof fetch;

    try {
      await tpbMusic.search("daft punk");
      expect(fetched[0]).toContain("q.php");
      expect(fetched[0]).toContain("daft%20punk");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("filters out non-audio categories from search results", async () => {
    const origFetch = globalThis.fetch;
    // Mix of audio (101) and video (201) categories — only audio should pass.
    const items = [
      { id: "1", name: "Music Track", info_hash: "AAA", category: "101", seeders: "10", leechers: "1", num_files: "5", size: "1000", added: "1000" },
      { id: "2", name: "Movie", info_hash: "BBB", category: "201", seeders: "50", leechers: "5", num_files: "1", size: "2000", added: "2000" },
    ];
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify(items), { status: 200 }),
      )) as typeof fetch;

    try {
      const results = await tpbMusic.search("test");
      // Category 201 (Movies) must be filtered out; only 101 (Music) passes.
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe("Music Track");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
