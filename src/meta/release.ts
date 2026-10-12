// Release names are the only metadata a tracker reliably gives us, and every scene/fansub group
// spells them differently. This module reduces one to a searchable title plus whatever season,
// episode and year fell out on the way. It is deliberately import-free and total: it runs on
// every visible row during a search, so it must never throw and never reach the network.
// Sanitizing the result for a terminal is the caller's job at the render boundary.

export type ReleaseKind = "movie" | "series";

export interface ParsedRelease {
  readonly title: string;
  readonly kind: ReleaseKind;
  readonly year?: number;
  readonly season?: number;
  readonly episode?: number;
  /** Release group / fansub tag. Informational only — never part of the search title. */
  readonly group?: string;
}

const CONTAINER_EXT = /\.(mkv|mp4|avi|ts|m2ts|iso|rar|mov|webm)$/i;

// A leading tag is a group; every other bracket is a candidate for removal. Full-width brackets
// are here because nyaa carries Chinese fansub names that use them.
const BRACKET_ANY = /[[(【]([^[\])】]*)[\])】]/g;
const BRACKET_LEADING = /^\s*[[(【]([^[\])】]*)[\])】]/;

const YEAR_ONLY = /^(19\d{2}|20\d{2})$/;
const YEAR_PAREN = /\((19\d{2}|20\d{2})\)/;
const YEAR_ANY = /\b(19\d{2}|20\d{2})\b/g;

// Fansub CRC stamps, e.g. "[ABCD1234]" — pure noise, but they look like a title to a naive split.
const CRC32 = /^[0-9A-F]{8}$/;

const RESOLUTION = /^\d{3,4}p$/i;
const DIMENSIONS = /^\d{3,4}x\d{3,4}$/;

// One frozen vocabulary rather than a regex alternation: membership is O(1) and the list stays
// readable when the next streaming-service tag has to be added.
const JUNK: ReadonlySet<string> = new Set([
  // quality
  "4k", "uhd", "8k", "hd", "sd", "hdr", "hdr10", "dv", "sdr",
  // source
  "bluray", "blu-ray", "bdrip", "bdremux", "brrip", "remux", "webrip", "web-dl", "webdl", "web",
  "hdtv", "pdtv", "dvdrip", "dvdscr", "dvd", "hdrip", "cam", "camrip", "ts", "telesync", "tc",
  "telecine", "hdcam", "screener", "scr", "r5", "vodrip", "amzn", "nf", "hulu", "dsnp", "atvp",
  "ma", "max", "hmax", "pmntp", "itunes",
  // codec
  "x264", "x265", "h264", "h265", "h.264", "h.265", "hevc", "avc", "xvid", "divx", "av1", "vp9",
  "10bit", "8bit", "10-bit", "hi10p",
  // audio
  "aac", "ac3", "eac3", "dts", "truehd", "ddp", "dd", "atmos", "flac", "mp3", "opus", "dual-audio",
  "5.1", "7.1", "2.0", "aac2.0", "ddp5.1", "dd5.1",
  // misc
  "multi", "multi-audio", "multi-subs", "subbed", "dubbed", "sub", "subs", "vostfr", "vf",
  "french", "truefrench", "ita", "eng", "esp", "repack", "proper", "extended", "uncut", "unrated",
  "remastered", "imax", "limited", "internal", "complete", "batch", "leak", "hq", "pre",
]);

// Trim only leading/trailing non-alphanumerics: interior punctuation is significant ("web-dl",
// "aac2.0", "h.264"). Unicode classes keep CJK titles intact instead of erasing them to "".
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

function isJunk(token: string): boolean {
  const t = token.toLowerCase().replace(EDGE_PUNCTUATION, "");
  if (t === "") return false;
  return JUNK.has(t) || RESOLUTION.test(t) || DIMENSIONS.test(t);
}

/** True when every dash/underscore/space-separated part of a bracket body is junk. */
function isJunkOnly(inner: string): boolean {
  if (isJunk(inner)) return true;
  const parts = inner.split(/[\s_-]+/).filter((p) => p !== "");
  return parts.length > 0 && parts.every(isJunk);
}

interface Token {
  readonly text: string;
  readonly index: number;
}

function tokenize(s: string): readonly Token[] {
  const out: Token[] = [];
  for (const m of s.matchAll(/\S+/g)) {
    if (m.index !== undefined) out.push({ text: m[0], index: m.index });
  }
  return out;
}

/**
 * `_` is never anything but a separator. `.` is ambiguous — it separates scene names but also
 * carries decimals ("AAC 2.0") — so only convert it when dots are pulling their weight as the
 * dominant separator. Ties go to dots: a name with as many dots as spaces is a scene name whose
 * title happens to contain spaces, and leaving the dots in would fuse title and junk tokens.
 */
export function normalizeSeparators(s: string): string {
  const underscored = s.replace(/_/g, " ");
  const dots = (underscored.match(/\./g) ?? []).length;
  const spaces = (underscored.match(/ /g) ?? []).length;
  return dots > 0 && dots >= spaces ? underscored.replace(/\./g, " ") : underscored;
}

const EP_SxxExx = /S(\d{1,2})[ ._-]?E(\d{1,3})/i;
const EP_NxNN = /\b(\d{1,2})x(\d{2})\b/i;
const EP_SEASON_WORD = /\bSeason[ ._-]?(\d{1,2})(?:[ ._-]?Episode[ ._-]?(\d{1,3}))?/i;
// SubsPlease / Erai-raws style "Show - 01", optionally version-stamped ("- 06v2").
const EP_DASH = /[ ._-]-[ ._-](\d{1,4})(?:v\d)?\b/;
const EP_BARE_SEASON = /\bS(\d{1,2})\b/i;

function toInt(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * First marker wins, strongest form first. The bare "- 01" form is last-resort and only trusted
 * past the first third of the name, because a hyphen that early is far more likely to be part of
 * the title ("Spider-Man - the ...") than an episode number.
 */
export function findEpisodeMarker(
  s: string,
): { index: number; season?: number; episode?: number } | null {
  const sxxexx = s.match(EP_SxxExx);
  if (sxxexx?.index !== undefined) {
    return { index: sxxexx.index, season: toInt(sxxexx[1]), episode: toInt(sxxexx[2]) };
  }

  const nxnn = s.match(EP_NxNN);
  if (nxnn?.index !== undefined) {
    return { index: nxnn.index, season: toInt(nxnn[1]), episode: toInt(nxnn[2]) };
  }

  const worded = s.match(EP_SEASON_WORD);
  if (worded?.index !== undefined) {
    return { index: worded.index, season: toInt(worded[1]), episode: toInt(worded[2]) };
  }

  const dash = s.match(EP_DASH);
  if (dash?.index !== undefined && dash.index >= s.length / 3) {
    // The dash form carries no season, but fansubs park one just before it ("… S4 - 17"), so
    // backfill from the text we are about to discard and cut at whichever marker comes first.
    const before = s.slice(0, dash.index);
    const season = before.match(EP_BARE_SEASON);
    if (season?.index !== undefined) {
      return { index: season.index, season: toInt(season[1]), episode: toInt(dash[1]) };
    }
    return { index: dash.index, episode: toInt(dash[1]) };
  }

  const bare = s.match(EP_BARE_SEASON);
  if (bare?.index !== undefined) return { index: bare.index, season: toInt(bare[1]) };

  return null;
}

/**
 * A parenthesised year is an explicit claim and always wins. A naked four-digit run is not — it
 * could be part of the title ("2012", "Blade Runner 2049") — so it only counts when junk follows
 * it, which is the shape of a real scene name, and never when it is all we have left.
 */
export function findYear(s: string): { index: number; year: number } | null {
  const paren = s.match(YEAR_PAREN);
  if (paren?.index !== undefined) {
    const year = toInt(paren[1]);
    if (year !== undefined) return { index: paren.index, year };
  }

  if (YEAR_ONLY.test(s.trim())) return null;

  const matches = [...s.matchAll(YEAR_ANY)];
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    if (m?.index === undefined) continue;
    const year = toInt(m[1]);
    if (year === undefined) continue;
    const trailing = tokenize(s.slice(m.index + m[0].length));
    if (trailing.some((t) => isJunk(t.text))) return { index: m.index, year };
  }
  return null;
}

/** Index of the first junk token, or -1. Token index, not character offset. */
export function firstJunkIndex(tokens: readonly string[]): number {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t !== undefined && isJunk(t)) return i;
  }
  return -1;
}

function stripLeadingGroup(s: string): { text: string; group?: string } {
  const lead = s.match(BRACKET_LEADING);
  const inner = lead?.[1]?.trim();
  if (lead === null || lead === undefined || inner === undefined || inner === "") return { text: s };
  // A leading "[1080p]" or "(2023)" is metadata, not a group — leave it for the generic pass.
  if (YEAR_ONLY.test(inner) || isJunkOnly(inner) || CRC32.test(inner)) return { text: s };
  return { text: s.slice(lead[0].length), group: inner };
}

function stripJunkBrackets(s: string): string {
  return s.replace(BRACKET_ANY, (whole: string, inner: string) => {
    const v = inner.trim();
    if (YEAR_ONLY.test(v)) return whole; // the year is the one bracket body worth keeping
    if (v === "" || isJunkOnly(v) || CRC32.test(v)) return " ";
    return whole;
  });
}

// Scene names end in "-GROUP" with no space before the dash — but so does an ordinary hyphenated
// title ("Spider-Man", "X-Men"), and so does "WEB-DL". Shape alone cannot tell them apart.
const TRAILING_GROUP = /-([A-Za-z][A-Za-z0-9]+)$/;

/**
 * A trailing "-GROUP" is only believable when the rest of the name reads like a scene release:
 * some junk token, a year, or an episode marker ahead of it. Without that corroboration the
 * hyphen belongs to the title, and taking it would search for "Spider" instead of "Spider-Man".
 * Rejecting a vocabulary candidate ("WEB-DL") stays as a second, independent guard.
 */
function stripTrailingGroup(s: string): { text: string; group?: string } {
  const m = s.match(TRAILING_GROUP);
  const candidate = m?.[1];
  if (m?.index === undefined || candidate === undefined) return { text: s };
  const lastToken = s.slice(s.lastIndexOf(" ") + 1);
  if (isJunk(lastToken) || isJunk(candidate)) return { text: s };

  const before = s.slice(0, m.index);
  const corroborated =
    firstJunkIndex(tokenize(before).map((t) => t.text)) >= 0 ||
    findYear(before) !== null ||
    findEpisodeMarker(before) !== null;
  if (!corroborated) return { text: s };

  return { text: s.slice(0, m.index), group: candidate };
}

const TRAILING_EZTV = /[\s._-]*EZTV$/i;
const TRAILING_PUNCTUATION = /[-:–,]+$/;

function tidy(s: string): string {
  let t = s.replace(/\s+/g, " ").trim();
  // EZTV staples its own name onto every row it publishes; it is never part of the title.
  t = t.replace(TRAILING_EZTV, "").trim();
  let previous = "";
  while (t !== previous) {
    previous = t;
    t = t.replace(TRAILING_PUNCTUATION, "").trim();
  }
  return t;
}

/**
 * Reduce a torrent release name to something worth querying a metadata provider with. Total by
 * construction: unparseable input yields an empty title rather than an exception, and the caller
 * decides whether an empty or junk-looking title is worth a lookup.
 */
export function parseRelease(name: string): ParsedRelease {
  if (typeof name !== "string" || name === "") return { title: "", kind: "movie" };

  const withoutExt = name.replace(CONTAINER_EXT, "");

  const lead = stripLeadingGroup(withoutExt);
  const debracketed = stripJunkBrackets(lead.text).replace(/\s+/g, " ").trim();

  // Separators are normalized before the group strip: the corroboration check reads the name as
  // tokens, and a dotted scene name is a single token until the dots become spaces.
  const normalized = normalizeSeparators(debracketed).replace(/\s+/g, " ").trim();
  const trailing = stripTrailingGroup(normalized);
  const s = trailing.text.trim();

  const marker = findEpisodeMarker(s);
  const year = findYear(s);
  const tokens = tokenize(s);
  const junkToken = firstJunkIndex(tokens.map((t) => t.text));

  const cuts: number[] = [];
  if (marker !== null) cuts.push(marker.index);
  if (year !== null) cuts.push(year.index);
  if (junkToken >= 0) {
    const t = tokens[junkToken];
    if (t !== undefined) cuts.push(t.index);
  }
  const cut = cuts.length > 0 ? Math.min(...cuts) : s.length;

  const title = tidy(s.slice(0, cut));
  const season = marker?.season;
  const episode = marker?.episode;
  const group = lead.group ?? trailing.group;

  return {
    title,
    kind: season !== undefined || episode !== undefined ? "series" : "movie",
    ...(year !== null ? { year: year.year } : {}),
    ...(season !== undefined ? { season } : {}),
    ...(episode !== undefined ? { episode } : {}),
    ...(group !== undefined ? { group } : {}),
  };
}
