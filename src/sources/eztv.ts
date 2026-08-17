import { fetchResilient, HttpError, USER_AGENT } from "../util/net";
import { imdbFromNumeric } from "../meta/cinemeta";
import { buildMagnet } from "./magnet";
import type { SearchOptions, Source, TorrentResult } from "./types";

const API = "https://eztvx.to/api/get-torrents";

// EZTV's API takes no text query. limit, page and imdb_id are the only inputs
// it reads -- keywords, q, search and title are accepted and ignored, every one
// of them answering with the same unfiltered latest page -- and the HTML search
// route is behind Cloudflare on every mirror (eztvx.to, eztv.re, eztv.wf,
// eztv.tf, eztv.yt, eztv1.xyz all answer /search/ with 403 "Just a moment").
// So a show name has to become an imdb_id before EZTV can answer it, and the
// only place to get that mapping without reaching for another service is EZTV's
// own feed: every row carries its show's imdb_id. Match the query against the
// recent feed, then ask for the shows it matched by id, which returns the whole
// catalogue rather than the couple of days the feed itself spans.
const PAGE_LIMIT = 100; // above 100 the API quietly answers with 30
const INDEX_PAGES = 10; // ~1000 rows, ~250 distinct shows, ~2.5 days of releases
const MAX_SHOWS = 2;
const MAX_RESULTS = 100; // one API page's worth, like every other query here

// The recent feed is the same for every query, so it is fetched once and shared
// instead of per query, on the same five-minute life the per-query cache in
// cache.ts uses.
const INDEX_TTL_MS = 5 * 60 * 1000;
let index: { at: number; rows: EztvTorrent[] } | null = null;

interface EztvTorrent {
  title?: string;
  filename?: string;
  imdb_id?: string;
  hash?: string;
  magnet_url?: string;
  seeds?: number;
  peers?: number;
  size_bytes?: string | number;
  date_released_unix?: number;
}
interface EztvResponse {
  torrents?: EztvTorrent[];
}

async function fetchPage(
  params: Record<string, string>,
  opts: SearchOptions,
  retries: number,
): Promise<EztvTorrent[]> {
  const qs = new URLSearchParams({ limit: String(PAGE_LIMIT), ...params });
  const res = await fetchResilient(`${API}?${qs.toString()}`, {
    headers: { "User-Agent": USER_AGENT },
    signal: opts.signal,
    retries,
  });
  if (!res.ok) throw new HttpError(res.status, `EZTV returned ${res.status}`);
  const json = (await res.json()) as EztvResponse;
  return json.torrents ?? [];
}

async function recentIndex(opts: SearchOptions): Promise<EztvTorrent[]> {
  const now = Date.now();
  if (index && now - index.at < INDEX_TTL_MS) return index.rows;

  // Page 1 is the request EZTV has always made here, and it still decides
  // whether the source is reachable at all. The deeper pages only widen the
  // window, so one of them failing narrows the search instead of breaking it.
  const pages = Array.from({ length: INDEX_PAGES }, (_, i) =>
    fetchPage({ page: String(i + 1) }, opts, i === 0 ? 1 : 0),
  );
  const guarded = pages.map((p, i) => (i === 0 ? p : p.catch(() => [] as EztvTorrent[])));
  const rows = (await Promise.all(guarded)).flat();
  index = { at: now, rows };
  return rows;
}

function haystack(t: EztvTorrent): string {
  return `${t.title ?? ""} ${t.filename ?? ""}`.toLowerCase();
}

function matches(t: EztvTorrent, tokens: string[]): boolean {
  const name = haystack(t);
  return tokens.every((token) => name.includes(token));
}

function toResult(t: EztvTorrent): TorrentResult | null {
  const hash = (t.hash ?? "").toLowerCase();
  const name = t.title || t.filename || hash;
  const magnet = t.magnet_url || (hash ? buildMagnet(hash, name) : "");
  if (!magnet || !hash) return null;
  return {
    infoHash: hash,
    name,
    sizeBytes: Number(t.size_bytes ?? 0) || 0,
    seeders: t.seeds ?? 0,
    leechers: t.peers ?? 0,
    source: "eztv",
    magnet,
    added: t.date_released_unix,
    // EZTV publishes the *series* id, bare digits and unpadded ("399664"), so it needs both the
    // tt-prefix and the same result-side validation every other remote id gets.
    imdbId: imdbFromNumeric(t.imdb_id),
  };
}

// A show's own catalogue overlaps the recent feed by definition, so the same
// hash arrives twice; keep the first and stop there.
function toResults(rows: EztvTorrent[]): TorrentResult[] {
  const byHash = new Map<string, TorrentResult>();
  for (const row of rows) {
    const r = toResult(row);
    if (r && !byHash.has(r.infoHash)) byHash.set(r.infoHash, r);
  }
  return [...byHash.values()];
}

function showIdsOf(hits: EztvTorrent[]): string[] {
  const ids: string[] = [];
  for (const t of hits) {
    const id = (t.imdb_id ?? "").trim();
    if (!id || id === "0" || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length === MAX_SHOWS) break;
  }
  return ids;
}

async function search(query: string, opts: SearchOptions = {}): Promise<TorrentResult[]> {
  const q = query.trim();
  // The empty query is the popular list, and one page is what it has always
  // been. Widening the index there would make every startup ten times heavier
  // for a view that does not need it.
  if (!q) return toResults(await fetchPage({ page: "1" }, opts, 1));

  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const recent = await recentIndex(opts);
  const hits = recent.filter((t) => matches(t, tokens));

  const catalogues = await Promise.all(
    showIdsOf(hits).map((imdb_id) =>
      fetchPage({ page: "1", imdb_id }, opts, 0).catch(() => [] as EztvTorrent[]),
    ),
  );

  const rows = [...hits, ...catalogues.flat().filter((t) => matches(t, tokens))];
  return toResults(rows)
    .sort((a, b) => b.seeders - a.seeders)
    .slice(0, MAX_RESULTS);
}

export const eztv: Source = {
  id: "eztv",
  label: "EZTV",
  groups: ["TV"],
  homepage: "https://eztvx.to",
  reportsHealth: true,
  search,
};
