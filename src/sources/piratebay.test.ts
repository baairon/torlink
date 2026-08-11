import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchResilient } from "../util/net";
import { tpbMovies, tpbMusic, tpbTv } from "./piratebay";

vi.mock("../util/net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../util/net")>();
  return { ...actual, fetchResilient: vi.fn() };
});

const mocked = vi.mocked(fetchResilient);

// An apibay row, trimmed to what the mapper reads. The info hash has to be a
// real 40-char hex string or the mapper drops the row.
function row(n: number, category: string, name = `Row ${n}`) {
  return {
    id: String(n),
    name,
    info_hash: n.toString(16).padStart(40, "0"),
    seeders: "10",
    leechers: "1",
    size: "1000",
    category,
  };
}

// Answers each URL from a table; anything unlisted rejects, so a test that
// reaches for an unexpected feed fails loudly rather than silently.
function serve(table: Record<string, unknown[]>): void {
  mocked.mockImplementation(async (url: string) => {
    const key = Object.keys(table).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected request: ${url}`);
    return {
      ok: true,
      status: 200,
      json: async () => table[key],
    } as unknown as Response;
  });
}

const names = (rows: { name: string }[]): string[] => rows.map((r) => r.name);

beforeEach(() => {
  mocked.mockReset();
});

describe("Pirate Bay music category filter", () => {
  it("keeps music and lossless, drops audio books and music videos", async () => {
    serve({
      "q.php": [
        row(1, "101", "album mp3"),
        row(2, "104", "album flac"),
        row(3, "102", "novel audiobook"),
        row(4, "203", "live concert video"),
      ],
    });

    expect(names(await tpbMusic.search("some band"))).toEqual(["album mp3", "album flac"]);
  });

  it("filters the browse feed too, since Audio's top-100 mixes music with audio books", async () => {
    serve({
      data_top100_100: [row(1, "104", "flac rip"), row(2, "102", "audiobook")],
    });

    expect(names(await tpbMusic.search(""))).toEqual(["flac rip"]);
  });

  it("keeps a row that carries no category rather than dropping it", async () => {
    serve({ "q.php": [{ ...row(1, "", "unfiled release"), category: undefined }] });
    expect(names(await tpbMusic.search("x"))).toEqual(["unfiled release"]);
  });

  it("leaves the movie and TV tabs' own filters untouched", async () => {
    serve({ "q.php": [row(1, "207", "a movie"), row(2, "101", "an album")] });
    expect(names(await tpbMovies.search("x"))).toEqual(["a movie"]);

    serve({ "q.php": [row(1, "208", "an episode"), row(2, "101", "an album")] });
    expect(names(await tpbTv.search("x"))).toEqual(["an episode"]);
  });

  it("leaves a movie browse feed intact now that browse is filtered as well", async () => {
    // 207 is exactly what MOVIE_CATS admits, so the new browse-side filter is a
    // no-op here — this is the regression guard for that.
    serve({ data_top100_207: [row(1, "207", "top movie")] });
    expect(names(await tpbMovies.search(""))).toEqual(["top movie"]);
  });
});

describe("Pirate Bay tab wiring", () => {
  it("gives music its own source id and group", () => {
    expect(tpbMusic.id).toBe("tpb-music");
    expect(tpbMusic.groups).toEqual(["Music"]);
    // Same site, so it still reports real swarm counts.
    expect(tpbMusic.reportsHealth).toBe(true);
    // One site, one label: the tag answers who found a row, not what kind.
    expect(new Set([tpbMovies.label, tpbTv.label, tpbMusic.label])).toEqual(new Set(["TPB"]));
  });
});
