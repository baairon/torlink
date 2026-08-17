import { fetchResilient, USER_AGENT } from "../util/net";
import { cleanText } from "../util/format";
import { normalizeImdbId } from "./imdbId";
import type { CatalogHit, EpisodeMeta, Meta, MetaKind } from "./types";

// Cinemeta is Stremio's public metadata addon: keyless, CORS-open, IMDb-keyed. torlink uses it
// because a search row needs a title, a year and a poster with no account, no API key and no
// per-user rate limit to explain to the user.
//
// Everything here fails soft. These calls are made from a React render path, so a dead provider,
// a hostile payload or a slow network must degrade to "no metadata", never to a thrown exception
// that unmounts the TUI. That is why every mapper is total and every network function returns
// null/[] instead of rejecting.
export const CINEMETA = "https://v3-cinemeta.strem.io";

// One request per row of interest, so the budget is short: a stale poster is worthless once the
// user has already scrolled past the row that wanted it.
const TIMEOUT_MS = 6000;

// A long-running series carries every episode in its meta document — One Piece is 1.35 MB — but
// nothing legitimate approaches this. The cap exists so a hostile or broken upstream cannot make
// us buffer an unbounded body into a terminal app's heap.
const MAX_META_BYTES = 3_000_000;

// Metahub is Stremio's own poster CDN, keyed by IMDb id, and it is the only host we will point
// an image loader at besides Amazon's image server.
const METAHUB = "https://images.metahub.space/poster/small";

// Amazon's image server encodes the rendition in the filename. Anchored end to end so nothing
// but a plain path under that host can match: this string ends up in an outbound request.
const AMAZON_POSTER = /^https:\/\/m\.media-amazon\.com\/images\/M\/[\w@.-]+\._V1_SX\d+\.jpg$/;

// The terminal renders posters as a few dozen character cells, so ask Amazon for the smallest
// sane rendition rather than the ~200 KB original the API links to.
const POSTER_WIDTH = "SX120";

const MAX_GENRES = 6;
const MAX_CAST = 12;
const MAX_DIRECTORS = 3;
const MAX_PLOT = 800;

// Ceiling on any single remote string, applied before it is cleaned. MAX_META_BYTES lets a 3 MB
// body through and the list caps below bound the *count* of entries, not the length of one — so
// without this a single field is free to be the whole body. That costs twice, and both costs are
// real rather than theoretical:
//
//   - cleanText walks a string code point by code point, so running it over a 2.9 MB description
//     and only then slicing to MAX_PLOT takes ~295 ms, against ~0.25 ms for slicing first. For
//     scale, JSON.parse of that same body is ~2 ms.
//   - a single oversized cast entry or genre survives into Meta and reaches wordWrapLines in
//     MetaPane's planPaneLines, which re-runs on *every* render: ~176 ms per frame for a 1 MB
//     token, i.e. a pane that re-wraps a megabyte on each keystroke. The row is ultimately
//     dropped (planPaneLines admits a block all-or-nothing) so nothing overflows — the cost is
//     paid in full for output that is thrown away.
//
// One cap here rather than one per call site: text() is the single funnel every remote string
// passes through, so capping it is what makes "no unbounded string leaves this module" a property
// instead of a checklist. 1500 cannot truncate anything legitimate — the longest field, the plot,
// is cut to 800 immediately after, and every other string is a name, a year, a runtime or an
// episode title.
const MAX_FIELD = 1500;

// An unpaired surrogate — half of an astral character, with no other half — is the one input that
// makes encodeURIComponent throw URIError. It is remotely reachable: JSON.parse turns a "\ud800"
// escape in a tracker payload into one, and cleanText() does not strip it. Half a character
// carries no meaning, so it is dropped rather than substituted.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

// The URL builders are exported and called directly, so "never throws" is part of their contract,
// not just an accident of being wrapped in a try/catch upstream.
function encodeSegment(s: string): string {
  return encodeURIComponent(s.replace(LONE_SURROGATE, ""));
}

export function searchUrl(kind: MetaKind, query: string): string {
  // The query is a path segment, not a query string, so it has to be percent-encoded or a title
  // containing "/" or "#" would rewrite the route.
  return `${CINEMETA}/catalog/${kind}/top/search=${encodeSegment(query)}.json`;
}

export function metaUrl(kind: MetaKind, imdbId: string): string {
  return `${CINEMETA}/meta/${kind}/${encodeSegment(imdbId)}.json`;
}

/**
 * Pick a poster URL we are willing to fetch. Never the raw `meta.poster`: it varies by host and
 * can be WebP, which the terminal renderer cannot decode. A known Amazon rendition is rewritten
 * down to a thumbnail; anything else falls back to metahub, which is keyed by the (validated)
 * IMDb id. Metahub answers *progressive* JPEG for `?format=jpeg`, not baseline — verified live —
 * so the decoder behind this URL has to handle both scan types, and image.test.ts pins that with
 * an inlined progressive fixture. It can also still answer WebP despite the parameter, which is
 * why poster.ts sniffs the magic bytes rather than trusting either the host or the query string.
 */
export function posterUrlFor(imdbId: string, rawPoster?: string): string | undefined {
  const id = normalizeImdbId(imdbId);
  if (id === undefined) return undefined;
  if (rawPoster !== undefined && AMAZON_POSTER.test(rawPoster)) {
    // Anchored on the suffix, not on "SX\d+" anywhere: the opaque id before it can contain the
    // same shape, and rewriting that would forge a URL for a different image.
    return rawPoster.replace(/\._V1_SX\d+\.jpg$/, `._V1_${POSTER_WIDTH}.jpg`);
  }
  return `${METAHUB}/${id}/img?format=jpeg`;
}

// Remote strings reach a terminal, so they go through cleanText() at the boundary. cleanText()
// substitutes "Untitled" for an empty result, which is right for a title and wrong for every
// optional field — hence the blank check before, and the return of undefined rather than a
// placeholder for anything the payload simply did not carry.
function text(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  // Cap before anything else reads the string. cleanText and trim are both linear in their input,
  // so doing either first would pay for the whole hostile value to produce something that is about
  // to be cut down anyway. Testing the *capped* string for blankness rather than the original also
  // keeps the two in agreement: a field padded with MAX_FIELD leading spaces answers undefined,
  // instead of slipping past the blank check and coming back as cleanText's "Untitled" placeholder.
  const capped = raw.slice(0, MAX_FIELD);
  if (capped.trim() === "") return undefined;
  return cleanText(capped);
}

function stringList(raw: unknown, cap: number): string[] {
  // Cinemeta sends `null` (not `[]`) for director on series, and occasionally a bare string.
  if (typeof raw === "string") {
    const one = text(raw);
    return one === undefined ? [] : [one];
  }
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    const v = text(entry);
    if (v !== undefined) out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

function toInt(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.trunc(raw) : undefined;
  if (typeof raw !== "string") return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Map a catalog response to hits. Rows without a usable id or name are dropped, not defaulted. */
export function mapCatalog(json: unknown, kind: MetaKind): CatalogHit[] {
  const metas = asRecord(json)?.["metas"];
  if (!Array.isArray(metas)) return [];
  const out: CatalogHit[] = [];
  for (const entry of metas) {
    const row = asRecord(entry);
    if (row === undefined) continue;
    const imdbId = normalizeImdbId(row["imdb_id"]) ?? normalizeImdbId(row["id"]);
    const name = text(row["name"]);
    // A hit with no name cannot be scored against a release title, so it is noise.
    if (imdbId === undefined || name === undefined) continue;
    const releaseInfo = text(row["releaseInfo"]);
    out.push({
      imdbId,
      name,
      kind,
      ...(releaseInfo !== undefined ? { releaseInfo } : {}),
    });
  }
  return out;
}

/**
 * Find one episode in a series meta document. Cinemeta numbers episodes in `number` and repeats
 * it in `episode`; specials live in season 0, so an exact season match matters.
 */
export function pickEpisode(json: unknown, season: number, episode: number): EpisodeMeta | undefined {
  const root = asRecord(json);
  // Accepts either a whole response body or the inner meta object, because fetchMeta has the
  // former and a caller re-reading a cached meta has the latter.
  const videos = root?.["videos"] ?? asRecord(root?.["meta"])?.["videos"];
  if (!Array.isArray(videos)) return undefined;
  for (const entry of videos) {
    const v = asRecord(entry);
    if (v === undefined) continue;
    const s = toInt(v["season"]);
    const n = toInt(v["number"]) ?? toInt(v["episode"]);
    if (s !== season || n !== episode) continue;
    const title = text(v["title"] ?? v["name"]);
    const overview = text(v["overview"] ?? v["description"]);
    return {
      season,
      number: episode,
      ...(title !== undefined ? { title } : {}),
      ...(overview !== undefined ? { overview } : {}),
    };
  }
  return undefined;
}

/**
 * Map a meta response, or return null if it is not a real hit.
 *
 * Cinemeta answers HTTP 200 for ids it has never heard of, with a stub body carrying only
 * `{id, type, behaviorHints}`. The status code therefore proves nothing: the presence of
 * `meta.name` is the only signal that separates a real record from that stub.
 */
export function mapMeta(json: unknown, kind: MetaKind): Meta | null {
  const meta = asRecord(asRecord(json)?.["meta"]);
  if (meta === undefined) return null;

  const title = text(meta["name"]);
  if (title === undefined) return null;

  const imdbId = normalizeImdbId(meta["imdb_id"]) ?? normalizeImdbId(meta["id"]);
  if (imdbId === undefined) return null;

  const year = text(meta["releaseInfo"]);
  const rating = text(meta["imdbRating"]);
  const runtime = text(meta["runtime"]);
  const plotRaw = text(meta["description"] ?? meta["plot"]);
  // A synopsis is decoration next to a torrent row; anything past this is scroll, not information.
  const plot = plotRaw === undefined ? undefined : plotRaw.slice(0, MAX_PLOT);
  const rawPoster = typeof meta["poster"] === "string" ? meta["poster"] : undefined;
  const posterUrl = posterUrlFor(imdbId, rawPoster);

  return {
    imdbId,
    kind,
    title,
    genres: stringList(meta["genres"], MAX_GENRES),
    cast: stringList(meta["cast"], MAX_CAST),
    director: stringList(meta["director"], MAX_DIRECTORS),
    ...(year !== undefined ? { year } : {}),
    ...(rating !== undefined ? { rating } : {}),
    ...(runtime !== undefined ? { runtime } : {}),
    ...(plot !== undefined ? { plot } : {}),
    ...(posterUrl !== undefined ? { posterUrl } : {}),
  };
}

// A caller's cancellation and our own deadline are both reasons to stop, and the request should
// honour whichever fires first.
function deadline(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

// Refuse an oversized body before reading it. content-length is advisory, but a truthful cap is
// still worth having: it costs nothing and stops the common case of a genuinely huge document.
function withinSizeCap(res: Response): boolean {
  const declared = Number(res.headers.get("content-length"));
  return !Number.isFinite(declared) || declared <= MAX_META_BYTES;
}

/**
 * Search a Cinemeta catalog. Returns [] on any failure — a search row that cannot be enriched is
 * a cosmetic loss, so nothing here is worth propagating to the caller.
 */
export async function searchCatalog(
  kind: MetaKind,
  query: string,
  opts: { signal?: AbortSignal } = {},
): Promise<CatalogHit[]> {
  const q = query.trim();
  if (q === "") return [];
  try {
    const res = await fetchResilient(searchUrl(kind, q), {
      // One shot. This runs while the user is looking at the list; a backoff would deliver the
      // answer long after the row it belonged to stopped being interesting.
      retries: 0,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: deadline(opts.signal),
    });
    if (!res.ok || !withinSizeCap(res)) return [];
    return mapCatalog(await res.json(), kind);
  } catch {
    return [];
  }
}

/**
 * Fetch one title's metadata, optionally narrowed to a single episode. Returns null on failure,
 * on an unknown id (the HTTP-200 stub) and on an oversized body.
 */
export async function fetchMeta(
  kind: MetaKind,
  imdbId: string,
  opts: { signal?: AbortSignal; season?: number; episode?: number } = {},
): Promise<Meta | null> {
  const id = normalizeImdbId(imdbId);
  if (id === undefined) return null;
  try {
    const res = await fetchResilient(metaUrl(kind, id), {
      retries: 0,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: deadline(opts.signal),
    });
    if (!res.ok || !withinSizeCap(res)) return null;
    const json: unknown = await res.json();
    const meta = mapMeta(json, kind);
    if (meta === null) return null;
    const { season, episode } = opts;
    if (season === undefined || episode === undefined) return meta;
    const found = pickEpisode(json, season, episode);
    // No matching video is normal (an unaired episode, a mis-parsed number): keep the series
    // metadata rather than discarding a good hit over a missing row.
    return found === undefined ? meta : { ...meta, episode: found };
  } catch {
    return null;
  }
}
