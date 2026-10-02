import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CINEMETA,
  fetchMeta,
  mapCatalog,
  mapMeta,
  metaUrl,
  pickEpisode,
  posterUrlFor,
  searchCatalog,
  searchUrl,
} from "./cinemeta";
import { fetchResilient } from "../util/net";

vi.mock("../util/net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../util/net")>();
  return { ...actual, fetchResilient: vi.fn() };
});

const mockFetch = vi.mocked(fetchResilient);

// Trimmed captures of real Cinemeta responses. Long lists are cut down; field names and value
// shapes are verbatim, including `director: null` on series and the poster host.
const MATRIX_POSTER =
  "https://m.media-amazon.com/images/M/MV5BN2NmN2VhMTQtMDNiOS00NDlhLTliMjgtODE2ZTY0ODQyNDRhXkEyXkFqcGc@._V1_SX300.jpg";

const catalogBody = {
  metas: [
    {
      id: "tt0133093",
      imdb_id: "tt0133093",
      type: "movie",
      name: "The Matrix",
      releaseInfo: "1999",
      poster: MATRIX_POSTER,
    },
    {
      id: "tt10838180",
      imdb_id: "tt10838180",
      type: "movie",
      name: "The Matrix Resurrections",
      releaseInfo: "2021",
    },
  ],
};

const movieBody = {
  meta: {
    id: "tt0133093",
    imdb_id: "tt0133093",
    type: "movie",
    name: "The Matrix",
    releaseInfo: "1999",
    imdbRating: "8.7",
    runtime: "136 min",
    genres: ["Action", "Sci-Fi"],
    cast: ["Keanu Reeves", "Laurence Fishburne", "Carrie-Anne Moss"],
    director: ["Lana Wachowski", "Lilly Wachowski"],
    description: "A computer hacker learns from mysterious rebels about the true nature of his reality.",
    poster: MATRIX_POSTER,
  },
};

const seriesBody = {
  meta: {
    id: "tt0903747",
    imdb_id: "tt0903747",
    type: "series",
    name: "Breaking Bad",
    releaseInfo: "2008–2013",
    imdbRating: "9.5",
    runtime: "49 min",
    genres: ["Crime", "Drama", "Thriller"],
    cast: ["Bryan Cranston", "Aaron Paul", "Anna Gunn"],
    director: null,
    description: "A chemistry teacher diagnosed with cancer turns to manufacturing methamphetamine.",
    poster: "https://images.metahub.space/poster/medium/tt0903747/img",
    videos: [
      {
        id: "tt0903747:5:13",
        season: 5,
        number: 13,
        episode: 13,
        title: "To'hajiilee",
        overview: "Jesse's plan to hit Walt where he really lives is a success.",
        released: "2013-09-08T00:00:00.000Z",
      },
      {
        id: "tt0903747:5:14",
        season: 5,
        number: 14,
        episode: 14,
        title: "Ozymandias",
        overview: "Walt goes on the run.",
        released: "2013-09-15T00:00:00.000Z",
      },
    ],
  },
};

// Cinemeta answers HTTP 200 with this for an id it does not know.
const stubBody = {
  meta: {
    id: "tt99999999",
    type: "movie",
    behaviorHints: { defaultVideoId: null, hasScheduledVideos: false },
  },
};

const ok = (body: unknown, headers: Record<string, string> = {}): Response =>
  ({
    ok: true,
    status: 200,
    headers: new Headers(headers),
    json: vi.fn(async () => body),
  }) as unknown as Response;

beforeEach(() => {
  mockFetch.mockReset();
});

describe("searchUrl", () => {
  it("percent-encodes path separators and fragments in the query", () => {
    expect(searchUrl("movie", "a/b#c")).toBe(`${CINEMETA}/catalog/movie/top/search=a%2Fb%23c.json`);
  });

  it("keeps a dot verbatim, which cannot break out of the segment once slashes are encoded", () => {
    // encodeURIComponent leaves "." alone by design. That is safe here because a traversal needs
    // a separator, and every "/" is escaped — "../.." stays one opaque segment.
    expect(searchUrl("movie", "Mr. Robot")).toBe(`${CINEMETA}/catalog/movie/top/search=Mr.%20Robot.json`);
    expect(searchUrl("series", "../../etc/passwd")).toBe(
      `${CINEMETA}/catalog/series/top/search=..%2F..%2Fetc%2Fpasswd.json`,
    );
  });

  it("routes by kind", () => {
    expect(searchUrl("series", "breaking bad")).toContain("/catalog/series/top/");
  });

  // A "\ud800" escape in a tracker payload survives JSON.parse and cleanText as a lone surrogate,
  // and encodeURIComponent throws URIError on one. These helpers are exported and called directly,
  // so the guarantee has to hold here, not only inside the callers' try/catch.
  it("drops a lone surrogate instead of throwing", () => {
    expect(searchUrl("movie", "\uD800")).toBe(`${CINEMETA}/catalog/movie/top/search=.json`);
    expect(searchUrl("movie", "\uDFFF")).toBe(`${CINEMETA}/catalog/movie/top/search=.json`);
    expect(searchUrl("movie", "a\uD800b")).toBe(`${CINEMETA}/catalog/movie/top/search=ab.json`);
    expect(searchUrl("movie", "a\uDC00b")).toBe(`${CINEMETA}/catalog/movie/top/search=ab.json`);
    // Reversed pair: each half is unpaired in context, so both go.
    expect(searchUrl("movie", "a\uDC00\uD800b")).toBe(`${CINEMETA}/catalog/movie/top/search=ab.json`);
  });

  it("keeps a well-formed astral character", () => {
    expect(searchUrl("movie", "Dune \u{1F600}")).toBe(
      `${CINEMETA}/catalog/movie/top/search=Dune%20%F0%9F%98%80.json`,
    );
  });
});

describe("metaUrl", () => {
  it("builds the meta document url for a kind and id", () => {
    expect(metaUrl("movie", "tt0133093")).toBe(`${CINEMETA}/meta/movie/tt0133093.json`);
    expect(metaUrl("series", "tt0903747")).toBe(`${CINEMETA}/meta/series/tt0903747.json`);
  });

  it("drops a lone surrogate instead of throwing", () => {
    expect(metaUrl("movie", "\uD800")).toBe(`${CINEMETA}/meta/movie/.json`);
    expect(metaUrl("movie", "\uDFFF")).toBe(`${CINEMETA}/meta/movie/.json`);
    expect(metaUrl("movie", "tt013\uD8003093")).toBe(`${CINEMETA}/meta/movie/tt0133093.json`);
    expect(metaUrl("series", "tt090\uDC003747")).toBe(`${CINEMETA}/meta/series/tt0903747.json`);
  });

  it("keeps a well-formed astral character", () => {
    expect(metaUrl("movie", "tt0133093\u{1F600}")).toBe(
      `${CINEMETA}/meta/movie/tt0133093%F0%9F%98%80.json`,
    );
  });
});

describe("posterUrlFor", () => {
  it("rewrites a known Amazon rendition down to a thumbnail", () => {
    const raw = "https://m.media-amazon.com/images/M/MV5BabcXkFqcGc@._V1_SX250.jpg";
    expect(posterUrlFor("tt0133093", raw)).toBe(
      "https://m.media-amazon.com/images/M/MV5BabcXkFqcGc@._V1_SX120.jpg",
    );
  });

  it("falls back to metahub for any other poster, never echoing the raw url", () => {
    const metahub = "https://images.metahub.space/poster/small/tt0133093/img?format=jpeg";
    expect(posterUrlFor("tt0133093")).toBe(metahub);
    expect(posterUrlFor("tt0133093", "https://example.invalid/p.webp")).toBe(metahub);
    // Right host, wrong shape: an unanchored match would let this through.
    expect(posterUrlFor("tt0133093", "https://m.media-amazon.com/images/M/x._V1_SX250.jpg?q=1")).toBe(
      metahub,
    );
    expect(posterUrlFor("tt0133093", "http://m.media-amazon.com/images/M/x._V1_SX250.jpg")).toBe(metahub);
  });

  it("returns nothing when the id would not be safe in a url path", () => {
    expect(posterUrlFor("../../etc")).toBeUndefined();
  });
});

describe("mapCatalog", () => {
  it("maps catalog rows to hits", () => {
    expect(mapCatalog(catalogBody, "movie")).toEqual([
      { imdbId: "tt0133093", name: "The Matrix", releaseInfo: "1999", kind: "movie" },
      { imdbId: "tt10838180", name: "The Matrix Resurrections", releaseInfo: "2021", kind: "movie" },
    ]);
  });

  it("drops rows with no usable id or name instead of defaulting them", () => {
    const hits = mapCatalog(
      { metas: [{ id: "kitsu:42", name: "Some Anime" }, { id: "tt0133093" }, null, "x"] },
      "movie",
    );
    expect(hits).toEqual([]);
  });

  it("returns [] for a body that is not a catalog", () => {
    expect(mapCatalog(undefined, "movie")).toEqual([]);
    expect(mapCatalog({}, "movie")).toEqual([]);
    expect(mapCatalog({ metas: "nope" }, "movie")).toEqual([]);
    expect(mapCatalog([], "movie")).toEqual([]);
  });
});

describe("mapMeta", () => {
  it("maps a movie", () => {
    const meta = mapMeta(movieBody, "movie");
    expect(meta).toMatchObject({
      imdbId: "tt0133093",
      kind: "movie",
      title: "The Matrix",
      year: "1999",
      rating: "8.7",
      runtime: "136 min",
      genres: ["Action", "Sci-Fi"],
      director: ["Lana Wachowski", "Lilly Wachowski"],
    });
    expect(meta?.plot).toContain("computer hacker");
    // Never the raw poster: it is a 300px-wide rendition on a host we only trust in one shape.
    expect(meta?.posterUrl).toBe(
      "https://m.media-amazon.com/images/M/MV5BN2NmN2VhMTQtMDNiOS00NDlhLTliMjgtODE2ZTY0ODQyNDRhXkEyXkFqcGc@._V1_SX120.jpg",
    );
  });

  it("returns null for the http-200 stub Cinemeta sends for an unknown id", () => {
    expect(mapMeta(stubBody, "movie")).toBeNull();
  });

  it("returns null for anything that is not a meta document", () => {
    expect(mapMeta(null, "movie")).toBeNull();
    expect(mapMeta({}, "movie")).toBeNull();
    expect(mapMeta({ meta: "x" }, "movie")).toBeNull();
    expect(mapMeta({ meta: { name: "No Id Here" } }, "movie")).toBeNull();
  });

  it("survives director: null, which is what series always send", () => {
    const meta = mapMeta(seriesBody, "series");
    expect(meta?.director).toEqual([]);
    expect(meta?.year).toBe("2008–2013");
    expect(meta?.kind).toBe("series");
    // The series poster is on metahub but in the wrong size and format, so it is rebuilt.
    expect(meta?.posterUrl).toBe("https://images.metahub.space/poster/small/tt0903747/img?format=jpeg");
  });

  it("caps lists and plot length so one payload cannot flood the pane", () => {
    const meta = mapMeta(
      {
        meta: {
          id: "tt0133093",
          name: "Capped",
          genres: Array.from({ length: 20 }, (_, i) => `g${i}`),
          cast: Array.from({ length: 40 }, (_, i) => `c${i}`),
          director: Array.from({ length: 9 }, (_, i) => `d${i}`),
          description: "x".repeat(2000),
        },
      },
      "movie",
    );
    expect(meta?.genres).toHaveLength(6);
    expect(meta?.cast).toHaveLength(12);
    expect(meta?.director).toHaveLength(3);
    expect(meta?.plot).toHaveLength(800);
  });

  // The list caps above bound how many entries survive, not how long one entry may be, and
  // MAX_META_BYTES lets a 3 MB body through — so without a cap inside text() a single field is
  // free to be the whole body. Both tests below are about the cap being at the funnel: they assert
  // the length that leaves mapMeta, and that producing it did not cost a walk over the input.
  describe("caps the length of a single remote string", () => {
    // 2.9 MB, the size of a body that passes withinSizeCap. cleanText is linear, so cleaning this
    // before slicing to MAX_PLOT costs ~295 ms against ~0.25 ms for slicing first; the assertion
    // is deliberately an order of magnitude looser than that gap so it cannot flake on slow CI.
    const HUGE = "lorem ipsum dolor sit amet ".repeat(112_000);

    it("truncates a description without cleaning the whole thing first", () => {
      const started = performance.now();
      const meta = mapMeta({ meta: { id: "tt0133093", name: "Huge", description: HUGE } }, "movie");
      const elapsed = performance.now() - started;

      expect(meta?.plot).toHaveLength(800);
      expect(meta?.plot?.startsWith("lorem ipsum")).toBe(true);
      expect(elapsed).toBeLessThan(50);
    });

    it("caps a pathological cast entry before it can reach the pane's word wrapper", () => {
      // One 1 MB token. Nothing overflows the pane — planPaneLines admits a block all or nothing,
      // so the row is dropped — but wordWrapLines still walks it on every single render, which is
      // ~176 ms per frame. Capping here is what keeps that off the render path entirely.
      const meta = mapMeta(
        {
          meta: {
            id: "tt0133093",
            name: "Huge",
            cast: ["a".repeat(1_000_000), "Keanu Reeves"],
            genres: ["b".repeat(1_000_000)],
          },
        },
        "movie",
      );

      for (const s of [...(meta?.cast ?? []), ...(meta?.genres ?? [])]) {
        expect(s.length).toBeLessThanOrEqual(1500);
      }
      // The cap trims the offender, it does not drop it or the entries after it.
      expect(meta?.cast?.[1]).toBe("Keanu Reeves");
    });

    it("leaves every legitimate field untouched", () => {
      // Nothing Cinemeta really sends comes near the cap: the plot is cut to 800 right after, and
      // the rest are names, years and runtimes.
      const meta = mapMeta(movieBody, "movie");
      expect(meta?.title).toBe("The Matrix");
      expect(meta?.cast).toEqual(["Keanu Reeves", "Laurence Fishburne", "Carrie-Anne Moss"]);
      expect(meta?.plot).toBe(movieBody.meta.description);
    });

    it("answers undefined for a field that is only whitespace up to the cap", () => {
      // The blank check reads the capped string, so this cannot come back as "Untitled".
      const meta = mapMeta(
        { meta: { id: "tt0133093", name: "Padded", description: `${" ".repeat(2000)}real plot` } },
        "movie",
      );
      expect(meta?.plot).toBeUndefined();
    });
  });

  it("cleans terminal-hostile characters out of every string it keeps", () => {
    const meta = mapMeta(
      {
        meta: {
          id: "tt0133093",
          // A hijacked provider could ship an OSC/CSI sequence in any of these fields.
          name: "The \u001b[31mMatrix\u001b[0m",
          genres: ["  Action\u0007  ", "", "   ", "Sci-Fi"],
          description: "two\nlines\u200b here",
        },
      },
      "movie",
    );
    expect(meta?.title).toBe("The [31mMatrix[0m");
    // Blank entries are dropped rather than turning into cleanText's "Untitled" placeholder.
    expect(meta?.genres).toEqual(["Action", "Sci-Fi"]);
    // Junk code points are deleted, not replaced by a space, so the newline leaves no gap.
    expect(meta?.plot).toBe("twolines here");
  });
});

describe("pickEpisode", () => {
  it("finds S05E14 in a videos array", () => {
    expect(pickEpisode(seriesBody, 5, 14)).toEqual({
      season: 5,
      number: 14,
      title: "Ozymandias",
      overview: "Walt goes on the run.",
    });
  });

  it("accepts a bare meta object as well as a whole response body", () => {
    expect(pickEpisode(seriesBody.meta, 5, 13)?.title).toBe("To'hajiilee");
  });

  it("returns undefined when the episode is absent or the shape is wrong", () => {
    expect(pickEpisode(seriesBody, 5, 99)).toBeUndefined();
    expect(pickEpisode(seriesBody, 1, 14)).toBeUndefined();
    expect(pickEpisode(movieBody, 1, 1)).toBeUndefined();
    expect(pickEpisode(null, 1, 1)).toBeUndefined();
    expect(pickEpisode({ videos: "nope" }, 1, 1)).toBeUndefined();
  });
});

describe("searchCatalog", () => {
  it("requests the search catalog and maps the hits", async () => {
    mockFetch.mockResolvedValueOnce(ok(catalogBody));
    const hits = await searchCatalog("movie", "The Matrix");
    expect(mockFetch.mock.calls[0]?.[0]).toBe(`${CINEMETA}/catalog/movie/top/search=The%20Matrix.json`);
    expect(hits.map((h) => h.imdbId)).toEqual(["tt0133093", "tt10838180"]);
  });

  it("does not call out for an empty query", async () => {
    expect(await searchCatalog("movie", "   ")).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns [] instead of throwing when the request fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ENOTFOUND"));
    expect(await searchCatalog("movie", "The Matrix")).toEqual([]);
  });

  it("returns [] on a non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      headers: new Headers(),
      json: async () => ({}),
    } as unknown as Response);
    expect(await searchCatalog("movie", "The Matrix")).toEqual([]);
  });
});

describe("fetchMeta", () => {
  it("fetches and maps a movie", async () => {
    mockFetch.mockResolvedValueOnce(ok(movieBody));
    const meta = await fetchMeta("movie", "tt0133093");
    expect(mockFetch.mock.calls[0]?.[0]).toBe(`${CINEMETA}/meta/movie/tt0133093.json`);
    expect(meta?.title).toBe("The Matrix");
  });

  it("attaches the requested episode to a series", async () => {
    mockFetch.mockResolvedValueOnce(ok(seriesBody));
    const meta = await fetchMeta("series", "tt0903747", { season: 5, episode: 14 });
    expect(meta?.episode).toEqual({
      season: 5,
      number: 14,
      title: "Ozymandias",
      overview: "Walt goes on the run.",
    });
  });

  it("keeps the series meta when the episode is not in the document", async () => {
    mockFetch.mockResolvedValueOnce(ok(seriesBody));
    const meta = await fetchMeta("series", "tt0903747", { season: 9, episode: 9 });
    expect(meta?.title).toBe("Breaking Bad");
    expect(meta?.episode).toBeUndefined();
  });

  it("returns null for the unknown-id stub even though the status is 200", async () => {
    mockFetch.mockResolvedValueOnce(ok(stubBody));
    expect(await fetchMeta("movie", "tt99999999")).toBeNull();
  });

  it("rejects an oversized body without parsing it", async () => {
    const res = ok(movieBody, { "content-length": "5000000" });
    mockFetch.mockResolvedValueOnce(res);
    expect(await fetchMeta("movie", "tt0133093")).toBeNull();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("parses a body whose declared size is under the cap", async () => {
    mockFetch.mockResolvedValueOnce(ok(movieBody, { "content-length": "42000" }));
    expect((await fetchMeta("movie", "tt0133093"))?.title).toBe("The Matrix");
  });

  it("never puts an unvalidated id in the url", async () => {
    expect(await fetchMeta("movie", "../../admin")).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null instead of throwing when the request fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("timed out"));
    expect(await fetchMeta("movie", "tt0133093")).toBeNull();
  });
});
