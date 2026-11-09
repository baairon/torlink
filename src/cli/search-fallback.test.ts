import { afterEach, describe, expect, it, vi } from "vitest";
import { runSearch } from "./search";

// Keep the real adapters, cache, fallback and CLI aggregation; replace only
// the remote HTTP responses and the source list to keep this deterministic.
vi.mock("../sources/registry", async () => {
  const { yts } = await import("../sources/yts");
  const { fitgirl } = await import("../sources/fitgirl");
  return {
    SOURCES: [yts, fitgirl],
    sourcesByGroup: () => [
      { group: "Movies", sources: [yts] },
      { group: "Games", sources: [fitgirl] },
    ],
  };
});

afterEach(() => vi.unstubAllGlobals());

describe("CLI search recovery through real adapters", () => {
  it("recovers a movie typo through the YTS API adapter", async () => {
    const queries: Array<string | null> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const query = new URL(input).searchParams.get("query_term");
      queries.push(query);
      return Response.json({ data: { movies: query === "night" ? [
        { title: "Night of the Living Dead", torrents: [{ hash: "b".repeat(40), seeds: 10 }] },
        { title: "Night Train", torrents: [{ hash: "c".repeat(40), seeds: 100 }] },
      ] : [] } });
    }));
    const execution = await runSearch({ query: "night livng dead", category: "movies" });
    expect(execution.exitCode).toBe(0);
    expect(execution.document.results.map((row) => row.name)).toEqual(["Night of the Living Dead"]);
    expect(execution.document.count).toBe(1);
    expect(execution.document.sources.yts?.count).toBe(1);
    expect(queries).toEqual(["night livng dead", "night"]);
  });

  it("recovers a game typo through the WordPress RSS adapter", async () => {
    const queries: Array<string | null> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const query = new URL(input).searchParams.get("s");
      queries.push(query);
      const item = (name: string, hash: string) => `<item><title>${name}</title><description>
        &lt;a href="magnet:?xt=urn:btih:${hash}"&gt;link&lt;/a&gt;
        </description></item>`;
      return new Response(`<rss><channel>${query === "elden" ?
        item("Elden Ring", "d".repeat(40)) + item("Elden Quest", "e".repeat(40)) : ""}</channel></rss>`);
    }));
    const execution = await runSearch({ query: "elden rign", category: "games" });
    expect(execution.exitCode).toBe(0);
    expect(execution.document.results.map((row) => row.name)).toEqual(["Elden Ring"]);
    expect(execution.document.sources.fitgirl?.count).toBe(1);
    expect(queries).toEqual(["elden rign", "elden"]);
  });
});
