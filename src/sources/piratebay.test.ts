import { describe, it, expect, vi, beforeEach } from "vitest";
import { toResult, tpbMovies } from "./piratebay";
import { fetchResilient } from "../util/net";

vi.mock("../util/net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../util/net")>();
  return { ...actual, fetchResilient: vi.fn() };
});

const mockFetch = vi.mocked(fetchResilient);

const page = (items: unknown[]): Response =>
  ({ ok: true, status: 200, json: async () => items }) as unknown as Response;

// apibay answers an empty search with this single placeholder instead of [].
const SENTINEL = {
  id: "0",
  name: "No results returned",
  info_hash: "0000000000000000000000000000000000000000",
  category: "0",
};

const movieRow = {
  id: "1",
  name: "Dune Part Two 2024 1080p",
  info_hash: "a".repeat(40),
  seeders: "12",
  leechers: "3",
  size: "4000",
  num_files: "2",
  added: "1700000000",
  category: "207",
};

const askedUrl = (call: number): string => String(mockFetch.mock.calls[call]![0]);

beforeEach(() => {
  mockFetch.mockReset();
});

// apibay caches search results per exact URL, and a query can be stuck with
// the sentinel on one URL form while the alternate form answers fine (live:
// q=metallica is poisoned bare but healthy with &cat=0; q=dune the other way
// around). One retry on the other form re-rolls that cache key instead of
// showing the user an empty column.
describe("apibay sentinel retry", () => {
  it("retries with cat=0 when a search comes back as the no-results sentinel", async () => {
    mockFetch.mockResolvedValueOnce(page([SENTINEL]));
    mockFetch.mockResolvedValueOnce(page([movieRow]));
    const results = await tpbMovies.search("metallica");
    expect(results.map((r) => r.name)).toEqual([movieRow.name]);
    expect(askedUrl(0)).toBe("https://apibay.org/q.php?q=metallica");
    expect(askedUrl(1)).toBe("https://apibay.org/q.php?q=metallica&cat=0");
  });

  it("asks once when the search returns real rows", async () => {
    mockFetch.mockResolvedValueOnce(page([movieRow]));
    await tpbMovies.search("dune");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns empty when both forms answer with the sentinel", async () => {
    mockFetch.mockResolvedValueOnce(page([SENTINEL]));
    mockFetch.mockResolvedValueOnce(page([SENTINEL]));
    expect(await tpbMovies.search("qqqqzzzz")).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("never retries a browse, which hits the precompiled feed", async () => {
    mockFetch.mockResolvedValueOnce(page([movieRow]));
    await tpbMovies.search("");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(askedUrl(0)).toContain("/precompiled/");
  });
});

// Field names and value shapes are verbatim from an apibay q.php response.
const ROW = {
  id: "10944926",
  name: "The Matrix 1999 1080p BluRay x264",
  info_hash: "8C4ADBF9EBDC4C6D1D0F1B0F0E0D0C0B0A090807",
  seeders: "412",
  leechers: "17",
  num_files: "3",
  size: "2147483648",
  added: "1600000000",
  category: "207",
  imdb: "tt0133093",
} as const;

describe("toResult", () => {
  it("carries the IMDb id apibay supplies", () => {
    expect(toResult({ ...ROW }, "tpb-movies")).toMatchObject({
      infoHash: "8c4adbf9ebdc4c6d1d0f1b0f0e0d0c0b0a090807",
      source: "tpb-movies",
      imdbId: "tt0133093",
    });
  });

  it('rejects the "0" apibay sends for a row with no id', () => {
    // Not a sentinel check: normalizeImdbId refuses it on shape, the same way it refuses any other
    // remote string that is not tt + 7-10 digits.
    expect(toResult({ ...ROW, imdb: "0" }, "tpb-movies")?.imdbId).toBeUndefined();
    expect(toResult({ ...ROW, imdb: "" }, "tpb-movies")?.imdbId).toBeUndefined();
    expect(toResult({ ...ROW, imdb: "tt0133093/../admin" }, "tpb-tv")?.imdbId).toBeUndefined();
  });

  it("leaves the id absent when apibay omits the field entirely", () => {
    const { imdb: _imdb, ...withoutImdb } = ROW;
    expect(toResult(withoutImdb, "tpb-tv")?.imdbId).toBeUndefined();
  });

  it("still drops the rows it always dropped", () => {
    expect(toResult({ ...ROW, info_hash: "0".repeat(40) }, "tpb-movies")).toBeNull();
    expect(toResult({ ...ROW, id: "0" }, "tpb-movies")).toBeNull();
  });
});
