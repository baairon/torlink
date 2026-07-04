import { fetchResilient, HttpError, USER_AGENT } from "../util/net";
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

async function search(query: string, opts: SearchOptions = {}): Promise<TorrentResult[]> {
  const q = query.trim();
  const params = new URLSearchParams({ limit: "50" });
  if (q) params.set("query_term", q);
  else params.set("sort_by", "date_added");

  const json = await fetchMovies(params, opts);
  const out: TorrentResult[] = [];
  for (const movie of json.data?.movies ?? []) {
    const base = movie.title_long || movie.title || "Unknown";
    for (const t of movie.torrents ?? []) {
      if (!t.hash) continue;
      const infoHash = t.hash.toLowerCase();
      const tag = [t.quality, t.type].filter(Boolean).join(" ");
      const name = tag ? `${base} [${tag}]` : base;
      out.push({
        infoHash,
        name,
        sizeBytes: t.size_bytes ?? 0,
        seeders: t.seeds ?? 0,
        leechers: t.peers ?? 0,
        source: "yts",
        magnet: buildMagnet(infoHash, name),
        added: movie.date_uploaded_unix,
      });
    }
  }
  return out;
}

export const yts: Source = {
  id: "yts",
  label: "YTS",
  group: "Movies",
  homepage: "https://yts.mx",
  search,
};
