import { describe, it, expect, vi, beforeEach } from "vitest";
import { toResult } from "./eztv";

const mockFetch = vi.fn();

vi.mock("../util/net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../util/net")>();
  return { ...actual, fetchResilient: mockFetch };
});

const ok = (torrents: unknown[]): Response =>
  ({ ok: true, status: 200, json: async () => ({ torrents }) }) as unknown as Response;

function row(title: string, hash: string, extra: Record<string, unknown> = {}) {
  return {
    title,
    hash,
    magnet_url: `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`,
    imdb_id: "111",
    seeds: 10,
    peers: 1,
    size_bytes: "1000",
    date_released_unix: 1_700_000_000,
    ...extra,
  };
}

// Every request the source makes goes through this, keyed on what the API
// actually reads: the page number and the imdb_id.
function respond(reply: (page: number, imdbId: string | null) => unknown[] | number): void {
  mockFetch.mockImplementation(async (url: string) => {
    const params = new URL(String(url)).searchParams;
    const out = reply(Number(params.get("page")), params.get("imdb_id"));
    // A number stands for an HTTP status the source has to deal with itself.
    if (typeof out === "number") return { ok: false, status: out } as unknown as Response;
    return ok(out);
  });
}

const urls = (): string[] => mockFetch.mock.calls.map((c) => String(c[0]));

// The recent-feed index is shared across queries, so each test starts from a
// fresh module rather than a leftover one.
async function freshEztv(): Promise<typeof import("./eztv").eztv> {
  vi.resetModules();
  return (await import("./eztv")).eztv;
}

const JUDY = row("Judy Justice S04E79 1080p WEB h264", "a".repeat(40));
const JUDY_OLD = row("Judy Justice S01E01 720p WEB h264", "b".repeat(40));

// Field names and value shapes are verbatim from an EZTV get-torrents response.
const ROW = {
  title: "Show.Name.S01E02.1080p.WEB.h264-GROUP",
  filename: "Show.Name.S01E02.1080p.WEB.h264-GROUP.mkv",
  imdb_id: "399664",
  hash: "8C4ADBF9EBDC4C6D1D0F1B0F0E0D0C0B0A090807",
  magnet_url: "magnet:?xt=urn:btih:8c4adbf9ebdc4c6d1d0f1b0f0e0d0c0b0a090807",
  seeds: 88,
  peers: 5,
  size_bytes: "734003200",
  date_released_unix: 1600000000,
} as const;

beforeEach(() => {
  mockFetch.mockReset();
});

describe("toResult", () => {
  it("zero-pads EZTV's bare numeric series id into an IMDb id", () => {
    expect(toResult({ ...ROW })).toMatchObject({
      infoHash: "8c4adbf9ebdc4c6d1d0f1b0f0e0d0c0b0a090807",
      source: "eztv",
      imdbId: "tt0399664",
    });
  });

  it("leaves the id absent when EZTV's value is empty or already prefixed", () => {
    expect(toResult({ ...ROW, imdb_id: "" })?.imdbId).toBeUndefined();
    expect(toResult({ ...ROW, imdb_id: "tt0399664" })?.imdbId).toBeUndefined();
  });

  it("leaves the id absent when EZTV omits the field entirely", () => {
    const { imdb_id: _imdbId, ...withoutImdb } = ROW;
    expect(toResult(withoutImdb)?.imdbId).toBeUndefined();
  });

  it("still drops rows with no usable hash or magnet", () => {
    expect(toResult({ ...ROW, hash: "", magnet_url: "" })).toBeNull();
  });
});

describe("eztv search", () => {
  it("asks for one page and nothing else when the query is empty", async () => {
    respond(() => [JUDY]);
    const eztv = await freshEztv();

    const res = await eztv.search("");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(urls()[0]).toContain("page=1");
    expect(urls()[0]).not.toContain("imdb_id");
    expect(res).toHaveLength(1);
    expect(res[0]!.source).toBe("eztv");
  });

  it("finds the show in the recent feed, then asks for its whole catalogue", async () => {
    // The feed only reaches back a couple of days; S01E01 is only ever going to
    // come back from the imdb_id query.
    respond((page, imdbId) => {
      if (imdbId === "111") return [JUDY, JUDY_OLD];
      return page === 1 ? [JUDY] : [];
    });
    const eztv = await freshEztv();

    const res = await eztv.search("judy justice");

    expect(urls().some((u) => u.includes("imdb_id=111"))).toBe(true);
    expect(res.map((r) => r.infoHash).sort()).toEqual(["a".repeat(40), "b".repeat(40)]);
    expect(res.map((r) => r.name)).toContain("Judy Justice S01E01 720p WEB h264");
  });

  it("never asks for a catalogue when nothing in the feed matches", async () => {
    respond(() => [JUDY]);
    const eztv = await freshEztv();

    await expect(eztv.search("south park")).resolves.toEqual([]);
    expect(urls().every((u) => !u.includes("imdb_id"))).toBe(true);
  });

  it("narrows rather than fails when a deeper page is unavailable", async () => {
    respond((page, imdbId) => {
      if (imdbId === "111") return [JUDY, JUDY_OLD];
      if (page === 1) return [JUDY];
      if (page === 4) return 503;
      return [];
    });
    const eztv = await freshEztv();

    const res = await eztv.search("judy justice");

    expect(res.length).toBeGreaterThan(0);
  });

  it("still surfaces the error when the first page is unavailable", async () => {
    respond((page) => (page === 1 ? 503 : []));
    const eztv = await freshEztv();

    await expect(eztv.search("judy justice")).rejects.toThrow(/503/);
  });

  it("reuses the recent feed across queries instead of refetching it", async () => {
    respond((page, imdbId) => {
      if (imdbId === "111") return [JUDY, JUDY_OLD];
      return page === 1 ? [JUDY] : [];
    });
    const eztv = await freshEztv();

    await eztv.search("judy justice");
    const afterFirst = mockFetch.mock.calls.length;
    await eztv.search("judy justice 1080p");

    // Only the catalogue request, never the ten index pages again.
    expect(mockFetch.mock.calls.length - afterFirst).toBe(1);
  });
});
