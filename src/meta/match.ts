import type { ParsedRelease } from "./release";
import type { CatalogHit } from "./types";

// A provider's search endpoint answers a fuzzy query with a ranked-by-popularity list, and
// popularity is not relevance: querying "The Matrix" returns the sequels and the documentaries
// too. This module decides which hit — if any — the release name actually meant.
//
// The bias is deliberate and one-sided: showing the wrong film's poster and plot next to a
// torrent is worse than showing nothing, because the user cannot tell it is wrong. Every rule
// here is therefore built to abstain rather than guess.

// Articles carry no identity and providers disagree about them ("The Office" vs "Office, The"),
// so they are dropped rather than compared.
const ARTICLES: ReadonlySet<string> = new Set(["the", "a", "an"]);

// Below this, we show nothing. This is the single quality knob in the feature: the point scale
// below is arranged so that a title-prefix match with a contradicted year (60 + 30 − 40 = 50)
// lands under it, while the same prefix match with no year claim at all (60 + 30) clears it.
const THRESHOLD = 60;

const EXACT_TITLE = 100;
const PREFIX_TITLE = 60;
const ALL_TOKENS = 30;
const YEAR_AGREES = 40;
const YEAR_CONTRADICTS = -40;

// A release name and a catalog name for the same work differ in punctuation, case and accents far
// more often than in words. Fold all three away so the comparison is about the words.
const DIACRITICS = /[\u0300-\u036f]/g;
const NON_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu;

export function normalizeTitle(s: string): string {
  if (typeof s !== "string") return "";
  const folded = s.toLowerCase().normalize("NFKD").replace(DIACRITICS, "");
  return folded
    .replace(NON_ALPHANUMERIC, " ")
    .split(" ")
    .filter((t) => t !== "" && !ARTICLES.has(t))
    .join(" ");
}

/**
 * The first four-digit run of `releaseInfo`. A movie sends "1999"; a series sends a span,
 * "2008–2013" or open-ended "2016–", and its first year is the one a release name would carry.
 */
function leadingYear(releaseInfo: string | undefined): number | undefined {
  if (releaseInfo === undefined) return undefined;
  const m = releaseInfo.match(/\d{4}/);
  if (m === null) return undefined;
  const n = Number.parseInt(m[0], 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Additive score for one candidate. Higher is a better match; the caller decides what is good
 * enough. Total by construction — an unparseable title scores 0, it does not throw.
 */
export function scoreHit(parsed: ParsedRelease, hit: CatalogHit): number {
  const want = normalizeTitle(parsed.title);
  const got = normalizeTitle(hit.name);
  if (want === "" || got === "") return 0;

  let score = 0;
  if (want === got) score += EXACT_TITLE;
  // Prefix on a word boundary, not on characters: "matrix" must not claim "matrixxx", but it
  // should still recognise "matrix reloaded" as a near miss worth scoring.
  if (got === want || got.startsWith(`${want} `)) score += PREFIX_TITLE;

  const gotTokens = new Set(got.split(" "));
  const wantTokens = want.split(" ");
  // Rewards a reordered or padded title ("Léon: The Professional" vs "The Professional") that the
  // prefix rule cannot see.
  if (wantTokens.every((t) => gotTokens.has(t))) score += ALL_TOKENS;

  const hitYear = leadingYear(hit.releaseInfo);
  if (parsed.year !== undefined && hitYear !== undefined) {
    // ±1 because release names disagree with catalogs about festival, limited and regional
    // release dates all the time. A wider window would stop separating a film from its remake.
    score += Math.abs(parsed.year - hitYear) <= 1 ? YEAR_AGREES : YEAR_CONTRADICTS;
  }

  return score;
}

/**
 * The best-scoring hit, or null when nothing is convincing enough. Ties keep the earlier hit:
 * providers return their list popularity-first, which is the right tiebreak for equal evidence.
 */
export function pickBestHit(parsed: ParsedRelease, hits: readonly CatalogHit[]): CatalogHit | null {
  let best: CatalogHit | null = null;
  let bestScore = 0;
  for (const hit of hits) {
    const score = scoreHit(parsed, hit);
    if (score > bestScore) {
      bestScore = score;
      best = hit;
    }
  }
  return bestScore >= THRESHOLD ? best : null;
}
