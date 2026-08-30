import { beforeEach, describe, expect, it, vi } from "vitest";
import { isSearchableTitle, lookupMeta, metaCacheKey, metaKindFor, peekMeta } from "./lookup";
import { fetchMeta, searchCatalog } from "./cinemeta";
import type { CatalogHit, Meta } from "./types";
import type { SourceId, TorrentResult } from "../sources/types";

// The whole provider is mocked: no test here is allowed near a socket, and the point of these
// tests is the orchestration around the provider, not the provider itself.
vi.mock("./cinemeta", () => ({
  searchCatalog: vi.fn(),
  fetchMeta: vi.fn(),
}));

const mockSearch = vi.mocked(searchCatalog);
const mockMeta = vi.mocked(fetchMeta);

// The module-level cache has no reset hook — deliberately, mirroring sources/cache.ts — so every
// test invents its own title and infoHash and nothing leaks between them.
function row(over: Partial<TorrentResult> & { name: string; source?: SourceId }): TorrentResult {
  return {
    infoHash: over.name.toLowerCase().replace(/\W+/g, ""),
    sizeBytes: 2.1e9,
    seeders: 40,
    leechers: 6,
    source: "yts",
    magnet: "magnet:?xt=urn:btih:deadbeef",
    ...over,
  };
}

function meta(imdbId: string, title: string): Meta {
  return { imdbId, kind: "movie", title, genres: [], cast: [], director: [] };
}

function hit(imdbId: string, name: string, releaseInfo?: string): CatalogHit {
  return { imdbId, name, kind: "movie", ...(releaseInfo !== undefined ? { releaseInfo } : {}) };
}

beforeEach(() => {
  mockSearch.mockReset();
  mockMeta.mockReset();
  mockSearch.mockResolvedValue([]);
  mockMeta.mockResolvedValue(null);
});

describe("isSearchableTitle", () => {
  it("accepts titles that are legitimately two letters long", () => {
    expect(isSearchableTitle("Up")).toBe(true);
    expect(isSearchableTitle("It")).toBe(true);
    expect(isSearchableTitle("Her")).toBe(true);
  });

  it("accepts an all-digit title", () => {
    expect(isSearchableTitle("300")).toBe(true);
    expect(isSearchableTitle("1917")).toBe(true);
    expect(isSearchableTitle("2012")).toBe(true);
  });

  it("accepts accented and mixed-script titles on their Latin content", () => {
    expect(isSearchableTitle("Amélie")).toBe(true);
    expect(isSearchableTitle("Attack on Titan 進撃の巨人")).toBe(true);
  });

  it("rejects what a CJK-only fansub name parses down to", () => {
    // Verbatim output of parseRelease("【喵萌奶茶屋】★07月新番★[花織同學][04][1080p][繁體]"):
    // long, non-empty, and completely unsearchable. A length check waves it through.
    expect(isSearchableTitle("★07月新番★[花織同學][04] [繁體]")).toBe(false);
    expect(isSearchableTitle("【4月新番】【地。—关于地球的运动—】【01】")).toBe(false);
  });

  it("rejects a bare episode number and other non-Latin scripts", () => {
    expect(isSearchableTitle("04")).toBe(false);
    expect(isSearchableTitle("Брат")).toBe(false);
    expect(isSearchableTitle("")).toBe(false);
    expect(isSearchableTitle("   ")).toBe(false);
  });
});

describe("metaKindFor", () => {
  it("refuses a Games-only source outright", () => {
    expect(metaKindFor(row({ name: "Ravenmoor Deluxe Edition", source: "fitgirl" }))).toBeNull();
  });

  it("lets a single-category source overrule the release name", () => {
    // "S3" reads as a season marker to the parser, but YTS only ever publishes films.
    expect(metaKindFor(row({ name: "Nightgale S3 2019 1080p", source: "yts" }))).toBe("movie");
    expect(metaKindFor(row({ name: "Harbourlight 2019 1080p", source: "eztv" }))).toBe("series");
    expect(metaKindFor(row({ name: "Ashfall 2021 1080p", source: "nyaa" }))).toBe("series");
  });

  it("falls back to the release name for a multi-category source", () => {
    expect(metaKindFor(row({ name: "Coldwater 2018 1080p", source: "bittorrented" }))).toBe("movie");
    expect(metaKindFor(row({ name: "Coldwater S02E04 1080p", source: "bittorrented" }))).toBe("series");
  });

  it("does not let the unknown-source fallback classify a row as a game", () => {
    // getSource() answers DEFAULT_SOURCE (FitGirl, Games-only) for an id it does not know, which
    // would turn every unrecognised source into "never query".
    const unknown = row({ name: "Saltmarsh 2020 1080p", source: "not-a-source" as SourceId });
    expect(metaKindFor(unknown)).toBe("movie");
  });
});

describe("metaCacheKey", () => {
  it("collapses one film's quality rows onto a single key", () => {
    const a = row({ infoHash: "q1", name: "Tidewater (2018) [1080p BluRay]", imdbId: "tt3311111" });
    const b = row({ infoHash: "q2", name: "Tidewater (2018) [2160p WEB]", imdbId: "tt3311111" });
    expect(metaCacheKey(a)).toBe(metaCacheKey(b));
  });

  it("keeps two episodes of one series apart despite a shared series id", () => {
    // EZTV publishes the series id on every episode row, so the id alone is not a unique key.
    const e14 = row({ infoHash: "e14", name: "Foghorn S05E14 1080p", source: "eztv", imdbId: "tt3322222" });
    const e15 = row({ infoHash: "e15", name: "Foghorn S05E15 1080p", source: "eztv", imdbId: "tt3322222" });
    expect(metaCacheKey(e14)).not.toBe(metaCacheKey(e15));
  });

  it("collapses the same film arriving from different trackers", () => {
    const tpb = row({ infoHash: "t1", name: "Saltbreak.2019.1080p.BluRay.x264-GRP", source: "tpb-movies" });
    const x = row({ infoHash: "x1", name: "Saltbreak (2019) 1080p WEB-DL", source: "x1337-movies" });
    expect(metaCacheKey(tpb)).toBe(metaCacheKey(x));
  });

  it("keeps a shared id apart when the two rows resolve to different kinds", () => {
    // Same imdbId, but a movies feed and a TV feed disagree on what it is. They need different
    // Cinemeta URLs (/meta/movie/... vs /meta/series/...), and Cinemeta's HTTP-200 stub for a
    // wrong-type id would otherwise poison one feed's entry with the other's negative result.
    const movie = row({
      infoHash: "m1",
      name: "Driftglass (2020) 1080p",
      source: "tpb-movies",
      imdbId: "tt3355555",
    });
    const series = row({
      infoHash: "s1",
      name: "Driftglass S01E01 1080p",
      source: "tpb-tv",
      imdbId: "tt3355555",
    });
    expect(metaKindFor(movie)).toBe("movie");
    expect(metaKindFor(series)).toBe("series");
    expect(metaCacheKey(movie)).not.toBe(metaCacheKey(series));
  });
});

describe("lookupMeta", () => {
  it("uses a source-provided id and never searches", async () => {
    const found = meta("tt4400001", "Emberfall");
    mockMeta.mockResolvedValue(found);

    const r = row({ infoHash: "f1", name: "Emberfall (2021) [1080p BluRay]", imdbId: "tt4400001" });
    await expect(lookupMeta(r)).resolves.toEqual(found);

    expect(mockSearch).not.toHaveBeenCalled();
    expect(mockMeta).toHaveBeenCalledTimes(1);
    expect(mockMeta).toHaveBeenCalledWith("movie", "tt4400001", expect.anything());
  });

  it("passes the episode coordinates through the id fast path", async () => {
    mockMeta.mockResolvedValue(meta("tt4400002", "Nightpost"));
    const r = row({ infoHash: "f2", name: "Nightpost S02E07 1080p", source: "eztv", imdbId: "tt4400002" });
    await lookupMeta(r);
    expect(mockMeta).toHaveBeenCalledWith(
      "series",
      "tt4400002",
      expect.objectContaining({ season: 2, episode: 7 }),
    );
  });

  it("fetches once for three quality rows of the same film", async () => {
    mockMeta.mockResolvedValue(meta("tt4400003", "Glasshour"));
    const rows = ["720p", "1080p", "2160p"].map((q, i) =>
      row({ infoHash: `g${i}`, name: `Glasshour (2020) [${q} BluRay]`, imdbId: "tt4400003" }),
    );

    // Concurrently, so the in-flight map is what does the collapsing rather than the cache.
    const settled = await Promise.all(rows.map((r) => lookupMeta(r)));

    expect(mockMeta).toHaveBeenCalledTimes(1);
    expect(settled.every((m) => m?.title === "Glasshour")).toBe(true);
    // And once more after everything has settled, now served by the cache.
    await lookupMeta(row({ infoHash: "g3", name: "Glasshour (2020) [480p BluRay]", imdbId: "tt4400003" }));
    expect(mockMeta).toHaveBeenCalledTimes(1);
  });

  it("searches, matches and fetches when no id is supplied", async () => {
    mockSearch.mockResolvedValue([hit("tt4400004", "Winterlark", "2017")]);
    mockMeta.mockResolvedValue(meta("tt4400004", "Winterlark"));

    const r = row({ infoHash: "s1", name: "Winterlark.2017.1080p.BluRay.x264-GRP", source: "tpb-movies" });
    await expect(lookupMeta(r)).resolves.toEqual(meta("tt4400004", "Winterlark"));

    expect(mockSearch).toHaveBeenCalledWith("movie", "Winterlark", expect.anything());
    expect(mockMeta).toHaveBeenCalledWith("movie", "tt4400004", expect.anything());
  });

  it("negatively caches an unmatched row", async () => {
    // The catalog answers with a different film, so pickBestHit abstains.
    mockSearch.mockResolvedValue([hit("tt4400005", "Something Else Entirely", "1994")]);

    const r = row({ infoHash: "n1", name: "Duskmarch.2016.1080p.WEB-DL", source: "tpb-movies" });
    await expect(lookupMeta(r)).resolves.toBeNull();
    expect(mockSearch).toHaveBeenCalledTimes(1);

    await expect(lookupMeta(r)).resolves.toBeNull();
    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockMeta).not.toHaveBeenCalled();
    // And the miss is visible synchronously, so the hook shows no spinner on a revisit.
    expect(peekMeta(r)).toBeNull();
  });

  it("never touches the network for a games row", async () => {
    const r = row({ infoHash: "fg1", name: "Ravenmoor Deluxe Edition v1.2", source: "fitgirl" });
    await expect(lookupMeta(r)).resolves.toBeNull();
    expect(peekMeta(r)).toBeNull();
    expect(mockSearch).not.toHaveBeenCalled();
    expect(mockMeta).not.toHaveBeenCalled();
  });

  it("never touches the network for a name with no searchable title", async () => {
    const r = row({
      infoHash: "cjk1",
      name: "【喵萌奶茶屋】★07月新番★[花織同學][04][1080p][繁體]",
      source: "nyaa",
    });
    await expect(lookupMeta(r)).resolves.toBeNull();
    expect(peekMeta(r)).toBeNull();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("returns null on abort and leaves the cache untouched", async () => {
    mockSearch.mockResolvedValue([hit("tt4400006", "Stormglass", "2015")]);
    mockMeta.mockResolvedValue(meta("tt4400006", "Stormglass"));

    const ctrl = new AbortController();
    const r = row({ infoHash: "ab1", name: "Stormglass.2015.1080p.BluRay", source: "tpb-movies" });
    const pending = lookupMeta(r, { signal: ctrl.signal });
    ctrl.abort();
    await expect(pending).resolves.toBeNull();

    // Nothing was written, so the next visit is free to try again rather than being told "no
    // metadata" for the rest of the TTL.
    expect(peekMeta(r)).toBeUndefined();
    await expect(lookupMeta(r)).resolves.toEqual(meta("tt4400006", "Stormglass"));
    expect(peekMeta(r)).toEqual(meta("tt4400006", "Stormglass"));
  });

  it("survives a provider that rejects", async () => {
    // The real searchCatalog never rejects — it swallows everything and returns []. This pins the
    // belt-and-braces catch in lookupMeta: if that contract is ever broken, the render path still
    // gets null rather than an unhandled rejection, and nothing is recorded for a failure that
    // never produced an answer.
    mockSearch.mockRejectedValue(new Error("boom"));
    const r = row({ infoHash: "br1", name: "Ashenvale.2022.1080p.WEB-DL", source: "tpb-movies" });
    await expect(lookupMeta(r)).resolves.toBeNull();
    expect(peekMeta(r)).toBeUndefined();
  });
});

describe("shared requests", () => {
  it("keeps a request alive for the callers that still want it", async () => {
    // The Task 5 shape: a detail view and a pane both mounted on one row, then the detail closes.
    let settle: (m: Meta | null) => void = () => {};
    mockMeta.mockReturnValue(
      new Promise<Meta | null>((res) => {
        settle = res;
      }),
    );
    const found = meta("tt4400008", "Palewind");
    const r = row({ infoHash: "sh1", name: "Palewind (2020) [1080p]", imdbId: "tt4400008" });

    const leaving = new AbortController();
    const staying = new AbortController();
    const first = lookupMeta(r, { signal: leaving.signal });
    const second = lookupMeta(r, { signal: staying.signal });

    leaving.abort();
    await expect(first).resolves.toBeNull();

    // One caller walking away must not cancel the request, answer null for the other, or stop the
    // answer reaching the cache — the joiner has no way to notice and retry.
    settle(found);
    await expect(second).resolves.toEqual(found);
    expect(peekMeta(r)).toEqual(found);
    expect(mockMeta).toHaveBeenCalledTimes(1);
  });

  it("cancels the request once the last caller has gone", async () => {
    mockMeta.mockReturnValue(new Promise<Meta | null>(() => {}));
    const r = row({ infoHash: "sh2", name: "Duskvane (2020) [1080p]", imdbId: "tt4400009" });

    const a = new AbortController();
    const b = new AbortController();
    const first = lookupMeta(r, { signal: a.signal });
    const second = lookupMeta(r, { signal: b.signal });

    a.abort();
    b.abort();
    await expect(Promise.all([first, second])).resolves.toEqual([null, null]);

    const passed = mockMeta.mock.calls[0]?.[2]?.signal;
    expect(passed?.aborted).toBe(true);
  });

  it("starts a fresh request rather than joining a cancelled one", async () => {
    mockMeta.mockReturnValueOnce(new Promise<Meta | null>(() => {}));
    const found = meta("tt4400010", "Marrowfen");
    const r = row({ infoHash: "sh3", name: "Marrowfen (2020) [1080p]", imdbId: "tt4400010" });

    const gone = new AbortController();
    const abandoned = lookupMeta(r, { signal: gone.signal });
    gone.abort();
    await expect(abandoned).resolves.toBeNull();

    // The dead flight is still in the map at this point; joining it would relay its null forever.
    mockMeta.mockResolvedValue(found);
    await expect(lookupMeta(r)).resolves.toEqual(found);
    expect(mockMeta).toHaveBeenCalledTimes(2);
  });

  it("answers a caller that gave up before it asked, without touching the cache", async () => {
    const found = meta("tt4400011", "Thornhollow");
    mockMeta.mockResolvedValue(found);
    const r = row({ infoHash: "sh4", name: "Thornhollow (2020) [1080p]", imdbId: "tt4400011" });
    await lookupMeta(r);
    expect(peekMeta(r)).toEqual(found);

    // Even with the answer sitting in the cache, an abandoned caller is told nothing.
    const dead = AbortSignal.abort();
    await expect(lookupMeta(r, { signal: dead })).resolves.toBeNull();

    const untouched = row({ infoHash: "sh5", name: "Ravenglass (2020) [1080p]", imdbId: "tt4400012" });
    mockMeta.mockClear();
    await expect(lookupMeta(untouched, { signal: dead })).resolves.toBeNull();
    expect(mockMeta).not.toHaveBeenCalled();
  });
});

describe("negative caching", () => {
  it("forgets a miss long before it forgets a hit", async () => {
    mockSearch.mockResolvedValue([]);
    const missed = row({ infoHash: "tt1", name: "Fernmoor.2016.1080p.WEB-DL", source: "tpb-movies" });
    const found = meta("tt4400013", "Larkspur");
    mockMeta.mockResolvedValue(found);
    const hitRow = row({ infoHash: "tt2", name: "Larkspur (2018) [1080p]", imdbId: "tt4400013" });

    await lookupMeta(missed);
    await lookupMeta(hitRow);
    expect(peekMeta(missed)).toBeNull();
    expect(peekMeta(hitRow)).toEqual(found);

    // Five minutes on: a dead network at launch must not have killed metadata for the session, so
    // the miss is retried while the answer we actually got is still good.
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5 * 60 * 1000);
    try {
      expect(peekMeta(missed)).toBeUndefined();
      expect(peekMeta(hitRow)).toEqual(found);

      await lookupMeta(missed);
      expect(mockSearch).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });
});

describe("peekMeta", () => {
  it("reports an unresolved row as unknown, not as a miss", () => {
    expect(peekMeta(row({ infoHash: "pk1", name: "Hollowmere (2019) 1080p" }))).toBeUndefined();
  });

  it("serves a resolved row synchronously", async () => {
    const found = meta("tt4400007", "Brightwater");
    mockMeta.mockResolvedValue(found);
    const r = row({ infoHash: "pk2", name: "Brightwater (2018) [1080p]", imdbId: "tt4400007" });
    await lookupMeta(r);
    expect(peekMeta(r)).toEqual(found);
  });
});
