import { describe, it, expect } from "vitest";
import { normalizeTitle, pickBestHit, scoreHit } from "./match";
import { parseRelease, type ParsedRelease } from "./release";
import type { CatalogHit } from "./types";

const hit = (name: string, releaseInfo?: string, imdbId = "tt0000001"): CatalogHit => ({
  imdbId,
  name,
  kind: "movie",
  ...(releaseInfo !== undefined ? { releaseInfo } : {}),
});

const release = (title: string, year?: number): ParsedRelease => ({
  title,
  kind: "movie",
  ...(year !== undefined ? { year } : {}),
});

const MATRIX = hit("The Matrix", "1999", "tt0133093");
const RESURRECTIONS = hit("The Matrix Resurrections", "2021", "tt10838180");
const RELOADED = hit("The Matrix Reloaded", "2003", "tt0234215");

describe("normalizeTitle", () => {
  it("lowercases, drops punctuation and collapses whitespace", () => {
    expect(normalizeTitle("The Lord of the Rings: The Two Towers")).toBe("lord of rings two towers");
    expect(normalizeTitle("Spider-Man   -  No Way Home!")).toBe("spider man no way home");
    expect(normalizeTitle("WALL·E")).toBe("wall e");
  });

  it("folds accents so a catalog spelling and a scene spelling meet", () => {
    expect(normalizeTitle("Amélie")).toBe(normalizeTitle("Amelie"));
    expect(normalizeTitle("Léon: The Professional")).toBe("leon professional");
  });

  it("drops articles wherever they appear, since providers disagree about them", () => {
    expect(normalizeTitle("The Office")).toBe("office");
    expect(normalizeTitle("Office, The")).toBe("office");
    expect(normalizeTitle("A Quiet Place")).toBe("quiet place");
  });

  it("keeps digits, which are often the whole title", () => {
    expect(normalizeTitle("2012")).toBe("2012");
    expect(normalizeTitle("Blade Runner 2049")).toBe("blade runner 2049");
  });

  it("returns an empty string for input with nothing to compare", () => {
    expect(normalizeTitle("")).toBe("");
    expect(normalizeTitle("---")).toBe("");
    expect(normalizeTitle("The")).toBe("");
  });
});

describe("scoreHit", () => {
  it("scores an exact title with an agreeing year highest", () => {
    // exact 100 + prefix 60 + tokens 30 + year 40
    expect(scoreHit(release("The Matrix", 1999), MATRIX)).toBe(230);
  });

  it("allows a year to be one out, because catalogs and releases date films differently", () => {
    expect(scoreHit(release("The Matrix", 2000), MATRIX)).toBe(230);
    expect(scoreHit(release("The Matrix", 1998), MATRIX)).toBe(230);
  });

  it("penalises a contradicted year", () => {
    // exact 100 + prefix 60 + tokens 30 − year 40
    expect(scoreHit(release("The Matrix", 1997), MATRIX)).toBe(150);
  });

  it("scores a prefix match without an exact match", () => {
    // prefix 60 + tokens 30, no year on either side
    expect(scoreHit(release("The Matrix"), RESURRECTIONS)).toBe(90);
  });

  it("does not treat a longer word as a prefix match", () => {
    expect(scoreHit(release("Matrix"), hit("Matrixxx"))).toBe(0);
  });

  it("scores token containment when word order or padding differs", () => {
    // tokens 30 only: "the professional" is not a prefix of "leon professional"
    expect(scoreHit(release("The Professional"), hit("Léon: The Professional"))).toBe(30);
  });

  it("scores nothing when either side normalizes away", () => {
    expect(scoreHit(release(""), MATRIX)).toBe(0);
    expect(scoreHit(release("The Matrix"), hit(""))).toBe(0);
  });

  it("ignores a year the hit does not carry", () => {
    expect(scoreHit(release("The Matrix", 1999), hit("The Matrix"))).toBe(190);
  });

  it("reads the leading year of a series release span", () => {
    const bb = { imdbId: "tt0903747", name: "Breaking Bad", releaseInfo: "2008–2013", kind: "series" } as const;
    const parsed: ParsedRelease = { title: "Breaking Bad", kind: "series", year: 2008, season: 5, episode: 14 };
    expect(scoreHit(parsed, bb)).toBe(230);
    // The span's later years are not the leading year, so they contradict.
    expect(scoreHit({ ...parsed, year: 2013 }, bb)).toBe(150);
    expect(scoreHit({ ...parsed, year: 2008 }, { ...bb, releaseInfo: "2016–" })).toBe(150);
  });
});

describe("pickBestHit", () => {
  it("uses the year to separate a film from its sequels", () => {
    expect(pickBestHit(release("The Matrix", 1999), [RESURRECTIONS, RELOADED, MATRIX])?.imdbId).toBe(
      "tt0133093",
    );
    expect(pickBestHit(release("The Matrix Resurrections", 2021), [MATRIX, RESURRECTIONS])?.imdbId).toBe(
      "tt10838180",
    );
  });

  it("lets an exact title outrank a sequel whose year happens to agree", () => {
    // "The Matrix" + 2021 is 150 on the original (exact, wrong year) against 130 on Resurrections
    // (prefix, right year). The title is the stronger claim: a release that meant the sequel would
    // have carried the sequel's name.
    expect(pickBestHit(release("The Matrix", 2021), [MATRIX, RESURRECTIONS])?.imdbId).toBe("tt0133093");
  });

  it("prefers the exact title when no year is available at all", () => {
    expect(pickBestHit(release("The Matrix"), [RESURRECTIONS, MATRIX])?.imdbId).toBe("tt0133093");
  });

  it("returns null for an empty hit list", () => {
    expect(pickBestHit(release("The Matrix", 1999), [])).toBeNull();
  });

  it("returns null for a plausible-but-wrong title rather than showing the wrong poster", () => {
    // prefix 60 + tokens 30 − year 40 = 50, just under the threshold: the year says this is a
    // different film, and a wrong poster is worse than no poster.
    expect(scoreHit(release("The Matrix", 1999), RESURRECTIONS)).toBe(50);
    expect(pickBestHit(release("The Matrix", 1999), [RESURRECTIONS])).toBeNull();
  });

  it("returns null when nothing shares enough words", () => {
    expect(pickBestHit(release("Arrival", 2016), [hit("Arrested Development", "2003")])).toBeNull();
    expect(pickBestHit(release("Dune", 2021), [hit("Dune: Part Two", "2024")])).toBeNull();
  });

  it("accepts a hit that clears the threshold exactly", () => {
    // tokens 30 + year 40 = 70; token containment plus an agreeing year is enough on its own.
    expect(scoreHit(release("The Professional", 1994), hit("Léon: The Professional", "1994"))).toBe(70);
    expect(pickBestHit(release("The Professional", 1994), [hit("Léon: The Professional", "1994")])).not.toBeNull();
  });

  it("rejects a hit one point short of the threshold", () => {
    // A bare prefix match with no other evidence is 60 and is kept; take the tokens away and the
    // same hit falls to 0. There is no partial credit between them by design.
    expect(scoreHit(release("The Matrix"), RELOADED)).toBe(90);
    expect(scoreHit(release("Matrix Revolutions"), RELOADED)).toBe(0);
    expect(pickBestHit(release("Matrix Revolutions"), [RELOADED])).toBeNull();
  });

  it("keeps the earlier hit when two score the same", () => {
    const a = hit("The Matrix", "1999", "tt0133093");
    const b = hit("The Matrix", "1999", "tt9999999");
    expect(pickBestHit(release("The Matrix", 1999), [a, b])?.imdbId).toBe("tt0133093");
  });

  it("matches a real release name end to end", () => {
    const parsed = parseRelease("The.Matrix.1999.1080p.BluRay.x264-GROUP");
    expect(pickBestHit(parsed, [RESURRECTIONS, MATRIX, RELOADED])?.imdbId).toBe("tt0133093");
  });

  it("declines a release name that parsed to junk", () => {
    const parsed = parseRelease("1080p x264");
    expect(pickBestHit(parsed, [MATRIX])).toBeNull();
  });
});
