import { beforeEach, describe, expect, it, vi } from "vitest";
import { cachedSearch } from "../sources/cache";
import { sourcesByGroup } from "../sources/registry";
import type { TorrentResult } from "../sources/types";
import { HttpError } from "../util/net";
import { runSearch } from "./search";

vi.mock("../sources/cache", () => ({ cachedSearch: vi.fn() }));

const searchMock = vi.mocked(cachedSearch);

function result(
  infoHash: string,
  seeders: number,
  added: number,
  source: TorrentResult["source"],
): TorrentResult {
  return {
    infoHash,
    name: infoHash,
    source,
    sizeBytes: 1,
    seeders,
    leechers: 0,
    added,
    magnet: `magnet:?xt=urn:btih:${infoHash}`,
  };
}

beforeEach(() => {
  searchMock.mockReset();
});

describe("runSearch", () => {
  it("selects category sources and preserves partial failures", async () => {
    searchMock.mockImplementation(async (source) => {
      if (source.id === "yts") return [result("same", 10, 100, source.id)];
      if (source.id === "tpb-movies") {
        return [result("same", 20, 100, source.id), result("other", 15, 200, source.id)];
      }
      throw new HttpError(503, "source unavailable");
    });

    const execution = await runSearch({ query: "example movie", category: "movies" });
    const movieSourceIds = sourcesByGroup()
      .find(({ group }) => group === "Movies")!
      .sources.map(({ id }) => id);

    expect(searchMock.mock.calls.map(([source]) => source.id)).toEqual(movieSourceIds);
    expect(execution.exitCode).toBe(0);
    expect(execution.document.sources.yts).toEqual({ ok: true, count: 1, error: null, code: null });
    expect(execution.document.sources["x1337-movies"]).toEqual({
      ok: false,
      count: 0,
      error: "source unavailable",
      code: "HTTP 503",
    });
    expect(
      execution.document.results.map(({ infoHash, seeders }) => ({ infoHash, seeders })),
    ).toEqual([
      { infoHash: "same", seeders: 20 },
      { infoHash: "other", seeders: 15 },
    ]);
  });

  it("exits successfully when every source returns an empty result", async () => {
    searchMock.mockResolvedValue([]);

    const execution = await runSearch({ query: "legitimate empty search" });

    expect(execution.exitCode).toBe(0);
    expect(execution.document.category).toBe("all");
    expect(execution.document.count).toBe(0);
  });

  it("returns diagnostic output and exit 1 when every source fails", async () => {
    searchMock.mockRejectedValue(new Error("offline"));

    const execution = await runSearch({ query: "ubuntu", category: "games" });

    expect(execution.exitCode).toBe(1);
    expect(execution.document.results).toEqual([]);
    expect(execution.document.sources.fitgirl).toEqual({
      ok: false,
      count: 0,
      error: "offline",
      code: "no response",
    });
  });
});
