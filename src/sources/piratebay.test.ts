import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchResilient } from "../util/net";
import { tpbBooks, tpbMovies } from "./piratebay";

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

describe("Pirate Bay books category filter", () => {
  it("keeps e-books, comics and audio books together on one tab", async () => {
    serve({
      "q.php": [
        row(1, "601", "textbook pdf"),
        row(2, "602", "graphic novel cbz"),
        row(3, "102", "novel audiobook"),
        row(4, "699", "unrelated other"),
        row(5, "101", "album mp3"),
      ],
    });

    expect(names(await tpbBooks.search("something"))).toEqual([
      "textbook pdf",
      "graphic novel cbz",
      "novel audiobook",
    ]);
  });

  it("merges the two browse feeds books span", async () => {
    serve({
      data_top100_600: [row(1, "601", "ebook"), row(2, "699", "other")],
      data_top100_102: [row(3, "102", "audiobook")],
    });

    expect(names(await tpbBooks.search("")).sort()).toEqual(["audiobook", "ebook"]);
  });

  it("still browses when one of the two feeds is down", async () => {
    mocked.mockImplementation(async (url: string) => {
      if (url.includes("data_top100_102")) throw new Error("feed down");
      return {
        ok: true,
        status: 200,
        json: async () => [row(1, "601", "ebook")],
      } as unknown as Response;
    });

    // A partial list beats reporting the whole source offline.
    expect(names(await tpbBooks.search(""))).toEqual(["ebook"]);
  });

  it("throws when every browse feed is down, so the tab reports the outage", async () => {
    mocked.mockRejectedValue(new Error("all down"));
    await expect(tpbBooks.search("")).rejects.toThrow();
  });

  it("keeps a row that carries no category rather than dropping it", async () => {
    serve({ "q.php": [{ ...row(1, "", "unfiled release"), category: undefined }] });
    expect(names(await tpbBooks.search("x"))).toEqual(["unfiled release"]);
  });

  it("leaves the movie tab's filter untouched, in search and in browse", async () => {
    serve({ "q.php": [row(1, "207", "a movie"), row(2, "601", "an ebook")] });
    expect(names(await tpbMovies.search("x"))).toEqual(["a movie"]);

    // 207 is exactly what MOVIE_CATS admits, so the new browse-side filter is a
    // no-op here — this is the regression guard for that.
    serve({ data_top100_207: [row(1, "207", "top movie")] });
    expect(names(await tpbMovies.search(""))).toEqual(["top movie"]);
  });
});

describe("Pirate Bay tab wiring", () => {
  it("gives books its own source id and group", () => {
    expect(tpbBooks.id).toBe("tpb-books");
    expect(tpbBooks.groups).toEqual(["Books"]);
    // Same site, so it still reports real swarm counts.
    expect(tpbBooks.reportsHealth).toBe(true);
    // One site, one label: the tag answers who found a row, not what kind.
    expect(tpbBooks.label).toBe(tpbMovies.label);
  });
});
