import { fetchResilient, HttpError, USER_AGENT } from "../util/net";
import { normalizeImdbId } from "../meta/imdbId";
import { buildMagnet } from "./magnet";
import type { SearchOptions, Source, TorrentResult } from "./types";

const HOSTS = ["yts.mx", "yts.am", "yts.rs"];

interface YtsTorrent {
  hash?: string;
  quality?: string;
  type?: string;
  size_bytes?: number;
  seeds?: number;
  peers?: number;
}
interface YtsMovie {
  title_long?: string;
  title?: string;
  imdb_code?: string;
  date_uploaded_unix?: number;
  torrents?: YtsTorrent[];
}
interface YtsResponse {
  data?: { movies?: YtsMovie[] };
}

async function fetchMovies(params: URLSearchParams, opts: SearchOptions): Promise<YtsResponse> {
  let lastError: unknown;
  for (const host of HOSTS) {
    try {
      const res = await fetchResilient(`https://${host}/api/v2/list_movies.json?${params.toString()}`, {
        headers: { "User-Agent": USER_AGENT },
        signal: opts.signal,
        retries: 1,
      });
      if (res.ok) return (await res.json()) as YtsResponse;
      lastError = new HttpError(res.status, `YTS returned ${res.status}`);
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new HttpError(0, "YTS unreachable");
}

/** Exported for tests: the mapping is where every YTS quirk is absorbed. */
export function toResult(movie: YtsMovie, t: YtsTorrent): TorrentResult | null {
  if (!t.hash) return null;
  const infoHash = t.hash.toLowerCase();
  const base = movie.title_long || movie.title || "Unknown";
  const tag = [t.quality, t.type].filter(Boolean).join(" ");
  const name = tag ? `${base} [${tag}]` : base;
  return {
    infoHash,
    name,
    sizeBytes: t.size_bytes ?? 0,
    seeders: t.seeds ?? 0,
    leechers: t.peers ?? 0,
    source: "yts",
    magnet: buildMagnet(infoHash, name),
    added: movie.date_uploaded_unix,
    // One id per film, shared by its quality rows: validated here, at the trust boundary, not at
    // the point of use.
    imdbId: normalizeImdbId(movie.imdb_code),
  };
}

async function search(query: string, opts: SearchOptions = {}): Promise<TorrentResult[]> {
  const q = query.trim();
  const params = new URLSearchParams({ limit: "50" });
  if (q) params.set("query_term", q);
  else params.set("sort_by", "date_added");

  const json = await fetchMovies(params, opts);
  const out: TorrentResult[] = [];
  for (const movie of json.data?.movies ?? []) {
    for (const t of movie.torrents ?? []) {
      const r = toResult(movie, t);
      if (r) out.push(r);
    }
  }
  return out;
}

export const yts: Source = {
  id: "yts",
  label: "YTS",
  groups: ["Movies"],
  homepage: "https://yts.mx",
  reportsHealth: true,
  search,
};
