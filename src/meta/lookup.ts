import { SOURCES } from "../sources/registry";
import { fetchMeta, searchCatalog } from "./cinemeta";
import { normalizeTitle, pickBestHit } from "./match";
import { parseRelease } from "./release";
import type { ParsedRelease } from "./release";
import type { SourceGroup, TorrentResult } from "../sources/types";
import type { Meta, MetaKind } from "./types";

// The orchestrator between a torrent row and Cinemeta: decide whether a row is worth a lookup at
// all, turn it into a stable cache key, and make sure the same title is only ever fetched once.
//
// Shape is deliberately identical to sources/cache.ts — a module-level Map, a TTL constant, a key
// helper, no eviction and no persistence. A process-lifetime map is right here for the same reason
// it is right there: torlink is a short-lived terminal session, the working set is the handful of
// rows the user actually scrolled past, and a Meta is a few hundred bytes.
//
// Everything fails soft. This is reached from a React render path, so a dead provider or a hostile
// payload must degrade to "no metadata", never to an exception that unmounts the TUI.

// Metadata is far more stable than a search result set (which uses 5 minutes): a film's plot and
// poster do not change inside a session, so an answer we did get is worth keeping for most of one.
const TTL_MS = 30 * 60 * 1000;

// "No metadata" gets a much shorter life, because at this layer it is ambiguous. cinemeta.ts
// collapses a dead network, a 502 and a title Cinemeta genuinely does not carry into the same
// []/null, so a session started while DNS or a VPN is still settling would otherwise record a hard
// "nothing here" for every row the user scrolled past and keep serving it for half an hour after
// the network came back. Two minutes still absorbs the case this cache exists for — scrolling up
// and down a result page takes seconds, and no row is re-queried during it — while capping a
// transient outage at one stale pass instead of a dead session.
const NEGATIVE_TTL_MS = 2 * 60 * 1000;

// Matches cinemeta's own per-request budget. It exists here too because the lookup can chain two
// requests (search, then meta) and the *pair* needs a ceiling, not just each half.
const TIMEOUT_MS = 6000;

interface Entry {
  at: number;
  meta: Meta | null;
}

const cache = new Map<string, Entry>();

/**
 * One request that more than one caller may be waiting on.
 *
 * The request owns its own AbortController rather than borrowing the first caller's signal, and
 * `refs` counts the callers still interested. Only the last one to walk away cancels it: a caller
 * losing interest is not the same event as a cancelled request, and conflating the two let one
 * caller's abort hand every other caller a null they would then never retry.
 */
interface Flight {
  readonly promise: Promise<Meta | null>;
  readonly ctrl: AbortController;
  /** The composite actually passed to the provider: `ctrl` plus the timeout. */
  readonly signal: AbortSignal;
  refs: number;
}

// A second map so a fast scroll that lands on the same title twice — four YTS quality rows of one
// film, or a re-select after a re-sort — issues one request instead of one per landing.
const inflight = new Map<string, Flight>();

// Cinemeta is keyed by IMDb primary titles, which are Latin script. A release name that reduces to
// CJK, Cyrillic or a bare episode number carries nothing to search with, so querying it spends a
// request per row for a guaranteed miss. Nyaa's Chinese fansub names hit this on every single row:
// "【喵萌奶茶屋】★07月新番★[花織同學][04][1080p][繁體]" parses to a long, non-empty, entirely
// unsearchable title, which a plain length check waves straight through.
//
// Two Latin letters is the floor because real titles do get that short ("Up", "It", "Her"). The
// all-digit escape hatch keeps "300", "1917" and "2012" queryable while still rejecting the bare
// "04" that a fully-bracketed fansub name leaves behind. Mixed titles pass on their Latin half,
// which is the right call: "Attack on Titan 進撃の巨人" is searchable.
const LATIN_LETTER = /\p{Script=Latin}/gu;
const ALL_DIGITS = /^\d{3,4}$/;

export function isSearchableTitle(title: string): boolean {
  if (typeof title !== "string") return false;
  const t = title.trim();
  if (t === "") return false;
  if (ALL_DIGITS.test(t)) return true;
  return (t.match(LATIN_LETTER) ?? []).length >= 2;
}

function groupsFor(id: TorrentResult["source"]): readonly SourceGroup[] | undefined {
  // Deliberately not getSource(): it falls back to DEFAULT_SOURCE for an unknown id, and that
  // default is FitGirl — Games-only — so a source id we do not recognise would silently classify
  // as "never query" instead of falling through to the release name.
  return SOURCES.find((s) => s.id === id)?.groups;
}

/**
 * The source's own category, when it is unambiguous enough to overrule the release name. A YTS row
 * is a film even when its name carries something the parser reads as a season marker, and a
 * FitGirl row is a game no matter what the repack is called — which is what keeps games entirely
 * off the network. Anime is best-effort "series"; Cinemeta files most of it there.
 *
 * `every` rather than an index read: it states "only this group" directly and needs no length
 * check to satisfy noUncheckedIndexedAccess. Hence the emptiness guard, since every([]) is true.
 */
function kindFromGroups(groups: readonly SourceGroup[] | undefined, fallback: MetaKind): MetaKind | null {
  // No groups, or a source that feeds several (BitTorrented is Movies + TV): the name is all the
  // evidence there is.
  if (groups === undefined || groups.length === 0) return fallback;
  if (groups.every((g) => g === "Games")) return null;
  if (groups.every((g) => g === "Movies")) return "movie";
  if (groups.every((g) => g === "TV" || g === "Anime")) return "series";
  return fallback;
}

/** Which Cinemeta catalog a row belongs in, or null when it must never be queried. */
export function metaKindFor(r: TorrentResult): MetaKind | null {
  return plan(r).kind;
}

interface Plan {
  readonly kind: MetaKind | null;
  readonly parsed: ParsedRelease;
  readonly key: string;
}

/**
 * Everything derivable from a row without touching the network, computed once. parseRelease is
 * pure and cheap but not free, and metaKindFor, metaCacheKey and lookupMeta all want its output.
 */
function plan(r: TorrentResult): Plan {
  const parsed = parseRelease(r.name);
  const kind = kindFromGroups(groupsFor(r.source), parsed.kind);
  return { kind, parsed, key: cacheKey(r, kind ?? parsed.kind, parsed) };
}

/**
 * The key two rows share when they would produce the same metadata.
 *
 * With an id it is the id plus the episode coordinates, because Cinemeta answers a series id with
 * the whole show and we narrow it to one episode: EZTV hands us the *series* id on every row, so
 * without the coordinates S05E14 and S05E15 would collide on one entry and the second row would be
 * served the first one's episode title. Movies carry no coordinates, so YTS's four quality rows of
 * one film still collapse onto a single entry. `kind` is in the key too: the same IMDb id can arrive
 * from both a movies feed and a TV feed misclassifying it, and those need different Cinemeta URLs
 * (`/meta/movie/…` vs `/meta/series/…`). Cinemeta answers HTTP 200 with the "unknown id" stub for a
 * wrong-type lookup rather than 404ing, so without `kind` here one feed's stub would poison the
 * other's entry for the whole negative TTL.
 *
 * Without an id it is the normalized title plus everything that could distinguish two works with
 * it, which is what collapses the same film arriving from TPB, 1337x and BitTorrented.
 */
function cacheKey(r: TorrentResult, kind: MetaKind, parsed: ParsedRelease): string {
  const season = parsed.season ?? "";
  const episode = parsed.episode ?? "";
  if (r.imdbId !== undefined) return `imdb:${kind}:${r.imdbId}:${season}:${episode}`;
  return `guess:${kind}:${normalizeTitle(parsed.title)}:${parsed.year ?? ""}:${season}:${episode}`;
}

export function metaCacheKey(r: TorrentResult): string {
  return plan(r).key;
}

function read(key: string): Meta | null | undefined {
  const hit = cache.get(key);
  if (hit === undefined) return undefined;
  // A miss is far less trustworthy than a hit, so it is remembered for far less time.
  const ttl = hit.meta === null ? NEGATIVE_TTL_MS : TTL_MS;
  return Date.now() - hit.at < ttl ? hit.meta : undefined;
}

/**
 * Synchronous cache read: `undefined` means "not known yet, ask the network", `null` means "there
 * is no metadata for this row" and a Meta is the answer. The hook calls this first so revisiting a
 * row it already resolved renders instantly instead of flashing a spinner.
 *
 * A row that can never be queried — a game, or a name with no searchable title — answers null
 * rather than undefined: the answer is already final, and making the caller wait on a request that
 * will not happen would show that same spinner forever.
 */
export function peekMeta(r: TorrentResult): Meta | null | undefined {
  const p = plan(r);
  if (p.kind === null) return null;
  if (r.imdbId === undefined && !isSearchableTitle(p.parsed.title)) return null;
  return read(p.key);
}

/**
 * Commit a result, unless the request that produced it was cancelled.
 *
 * This guard is load-bearing. searchCatalog and fetchMeta return []/null for an aborted request
 * exactly as they do for a dead provider, so an abort is indistinguishable from a genuine miss at
 * this point — and caching it would pin "no metadata" on the row for the full TTL just because the
 * user scrolled past it before the answer arrived.
 */
function commit(key: string, meta: Meta | null, signal: AbortSignal): Meta | null {
  if (signal.aborted) return null;
  cache.set(key, { at: Date.now(), meta });
  return meta;
}

async function resolve(r: TorrentResult, p: Plan, kind: MetaKind, signal: AbortSignal): Promise<Meta | null> {
  // Only meaningful for a series, and fetchMeta wants both halves or neither.
  const episodeOpts =
    kind === "series" && p.parsed.season !== undefined && p.parsed.episode !== undefined
      ? { season: p.parsed.season, episode: p.parsed.episode }
      : {};

  // Fast path: the source already told us what this is, so skip the guessing round trip entirely.
  if (r.imdbId !== undefined) {
    return commit(p.key, await fetchMeta(kind, r.imdbId, { signal, ...episodeOpts }), signal);
  }

  const hits = await searchCatalog(kind, p.parsed.title, { signal });
  const best = pickBestHit(p.parsed, hits);
  // A confident abstention is worth remembering: scrolling repeatedly past an unmatched row should
  // cost nothing after the first pass.
  if (best === null) return commit(p.key, null, signal);
  return commit(p.key, await fetchMeta(kind, best.imdbId, { signal, ...episodeOpts }), signal);
}

/** Begin a request nobody is waiting on yet, and register it so the next caller can join it. */
function start(r: TorrentResult, p: Plan, kind: MetaKind): Flight {
  const ctrl = new AbortController();
  // The request's own deadline plus its own cancel handle. No caller signal is folded in here:
  // cancellation is driven by the refcount below, so the request outlives any single caller.
  const signal = AbortSignal.any([ctrl.signal, AbortSignal.timeout(TIMEOUT_MS)]);
  const flight: Flight = {
    ctrl,
    signal,
    refs: 0,
    // resolve() only calls functions that already swallow their own failures, but this is a render
    // path: one unforeseen throw here would surface as an unhandled rejection in the TUI.
    promise: resolve(r, p, kind, signal).catch((): Meta | null => null),
  };
  inflight.set(p.key, flight);
  // Retire the entry once it settles — but only if it is still the current one, so a replacement
  // started after a cancellation is never evicted by its predecessor.
  void flight.promise.finally(() => {
    if (inflight.get(p.key) === flight) inflight.delete(p.key);
  });
  return flight;
}

/**
 * Wait on a shared request as one of possibly several callers.
 *
 * A caller gets its own answer the moment its own signal aborts, without disturbing anyone else's.
 * The request itself is only cancelled when the count of interested callers reaches zero, which is
 * what keeps the two `useResultMeta` instances Task 5 mounts on one row from poisoning each other:
 * closing the detail view must not tell the still-open pane there is no metadata.
 */
async function join(flight: Flight, signal: AbortSignal | undefined): Promise<Meta | null> {
  flight.refs += 1;
  // Detaches the abort listener below; a caller's signal can easily outlive this join.
  const detach = new AbortController();
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    detach.abort();
    flight.refs -= 1;
    if (flight.refs <= 0) flight.ctrl.abort();
  };

  try {
    if (signal === undefined) return await flight.promise;
    const cancelled = new Promise<null>((settle) => {
      // Released from inside the listener rather than from the finally below, so the last caller's
      // abort reaches the provider synchronously — before any in-flight answer can be committed.
      signal.addEventListener(
        "abort",
        () => {
          release();
          settle(null);
        },
        { once: true, signal: detach.signal },
      );
    });
    return await Promise.race([flight.promise, cancelled]);
  } finally {
    release();
  }
}

/**
 * Metadata for one row, or null when there is none to be had. Never throws and never rejects.
 */
export async function lookupMeta(
  r: TorrentResult,
  opts: { signal?: AbortSignal } = {},
): Promise<Meta | null> {
  const p = plan(r);
  const kind = p.kind;
  if (kind === null) return null;
  if (r.imdbId === undefined && !isSearchableTitle(p.parsed.title)) return null;
  // A caller that has already given up gets nothing and starts nothing — including on the cache
  // path, where answering an abandoned request would be pointless work either way.
  if (opts.signal?.aborted === true) return null;

  const cached = read(p.key);
  if (cached !== undefined) return cached;

  const existing = inflight.get(p.key);
  // A flight whose own signal has already fired — the last caller left, or the deadline passed —
  // will never commit anything, so joining it would just relay its null. Start over instead.
  const flight =
    existing !== undefined && !existing.signal.aborted ? existing : start(r, p, kind);
  return join(flight, opts.signal);
}
