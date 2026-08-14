import { describe, it, expect, vi, beforeEach } from "vitest";
import { tpbMovies, tpbTv, tpbMusic } from "./piratebay";
import { fetchResilient } from "../util/net";

vi.mock("../util/net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../util/net")>();
  return { ...actual, fetchResilient: vi.fn() };
});

const mockFetch = vi.mocked(fetchResilient);

const page = (items: unknown[]): Response =>
  ({ ok: true, status: 200, json: async () => items }) as unknown as Response;

// apibay returns every field as a string; category comes back like "101".
const row = (category: string | undefined, i: number): Record<string, string | undefined> => ({
  id: String(i),
  name: `row-${category ?? "none"}-${i}`,
  info_hash: String(i).padStart(40, "a"),
  seeders: "5",
  leechers: "2",
  size: "1000",
  num_files: "1",
  added: "1700000000",
  category,
});

// One row per category across the audio (1xx) and video (2xx) trees, plus a
// row with no category at all. Any tab's search filter has to carve its exact
// slice out of this; any drift in the boundary changes a list below.
const SPECTRUM = [
  "100",
  "101",
  "102",
  "103",
  "104",
  "199",
  "201",
  "202",
  "203",
  "204",
  "205",
  "206",
  "207",
  "208",
  "209",
  "299",
].map((c, i) => row(c, i + 1));
const NO_CATEGORY = row(undefined, 90);

// apibay answers an empty search with this single placeholder instead of [].
const SENTINEL = {
  id: "0",
  name: "No results returned",
  info_hash: "0000000000000000000000000000000000000000",
  category: "0",
};

const askedUrl = (call: number): string => String(mockFetch.mock.calls[call]![0]);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("tpbMusic", () => {
  it("feeds Music only, never the video tabs", () => {
    expect(tpbMusic.id).toBe("tpb-music");
    expect(tpbMusic.groups).toEqual(["Music"]);
    expect(tpbMusic.reportsHealth).toBe(true);
  });

  it("searches keep Music (101) and FLAC (104) rows and drop every other category", async () => {
    mockFetch.mockResolvedValueOnce(page([...SPECTRUM, NO_CATEGORY, SENTINEL]));
    const results = await tpbMusic.search("daft punk");
    // The URL carries the query; the boundary, not the exact param list, is
    // this suite's concern.
    expect(askedUrl(0)).toContain("/q.php?q=daft%20punk");
    expect(results.map((r) => r.name)).toEqual(["row-101-2", "row-104-5"]);
    expect(results.every((r) => r.source === "tpb-music")).toBe(true);
  });

  // 104 is not decoration: live apibay results for an artist search are
  // majority FLAC, so dropping it would gut TPB's music coverage.
  it("excludes audio books (102), sound clips (103), other audio (199) and music videos (203)", async () => {
    mockFetch.mockResolvedValueOnce(
      page([row("102", 1), row("103", 2), row("199", 3), row("203", 4)]),
    );
    expect(await tpbMusic.search("some artist")).toEqual([]);
  });

  it("browses the music-only top100 leaf, not the parent audio feed", async () => {
    mockFetch.mockResolvedValueOnce(page([row("101", 1)]));
    await tpbMusic.search("");
    // The 101 leaf is all music; the parent 100 feed mixes in audio books,
    // which would need a shared-path filter change to keep out. Pinned so a
    // feed swap is a conscious decision, not a drive-by.
    expect(askedUrl(0)).toBe("https://apibay.org/precompiled/data_top100_101.json");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("passes browse rows through without the category filter, like every tab", async () => {
    mockFetch.mockResolvedValueOnce(page([row("101", 1), row("104", 2), NO_CATEGORY]));
    const results = await tpbMusic.search("");
    expect(results).toHaveLength(3);
  });

  it("drops rows with no category from search results", async () => {
    mockFetch.mockResolvedValueOnce(page([row("101", 1), NO_CATEGORY]));
    const results = await tpbMusic.search("daft punk");
    expect(results.map((r) => r.name)).toEqual(["row-101-1"]);
  });

  it("never surfaces apibay's no-results sentinel row", async () => {
    mockFetch.mockResolvedValueOnce(page([SENTINEL]));
    expect(await tpbMusic.search("qqqqzzzz")).toEqual([]);
    mockFetch.mockResolvedValueOnce(page([SENTINEL, row("101", 1)]));
    expect((await tpbMusic.search("")).map((r) => r.name)).toEqual(["row-101-1"]);
  });
});

// The Movies and TV pins below assert the behavior those tabs shipped with.
// The Music source reuses their search path untouched; these make sure that
// stays true from either direction.
describe("tpbMovies", () => {
  it("filters searches to exactly the four movie categories", async () => {
    mockFetch.mockResolvedValueOnce(page([...SPECTRUM, NO_CATEGORY, SENTINEL]));
    const results = await tpbMovies.search("dune");
    expect(results.map((r) => r.name)).toEqual([
      "row-201-7",
      "row-202-8",
      "row-207-13",
      "row-209-15",
    ]);
  });

  it("browses the HD movies feed unfiltered, as before", async () => {
    mockFetch.mockResolvedValueOnce(page([...SPECTRUM, NO_CATEGORY]));
    const results = await tpbMovies.search("");
    expect(askedUrl(0)).toBe("https://apibay.org/precompiled/data_top100_207.json");
    expect(results).toHaveLength(SPECTRUM.length + 1);
  });
});

describe("tpbTv", () => {
  it("filters searches to exactly the two TV categories", async () => {
    mockFetch.mockResolvedValueOnce(page([...SPECTRUM, NO_CATEGORY, SENTINEL]));
    const results = await tpbTv.search("severance");
    expect(results.map((r) => r.name)).toEqual(["row-205-11", "row-208-14"]);
  });

  it("browses the HD TV feed unfiltered, as before", async () => {
    mockFetch.mockResolvedValueOnce(page([...SPECTRUM, NO_CATEGORY]));
    const results = await tpbTv.search("");
    expect(askedUrl(0)).toBe("https://apibay.org/precompiled/data_top100_208.json");
    expect(results).toHaveLength(SPECTRUM.length + 1);
  });
});
