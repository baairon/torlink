import { fetchResilient, HttpError, USER_AGENT } from "../util/net";
import { buildMagnet } from "./magnet";
import type { SearchOptions, Source, SourceId, TorrentResult } from "./types";

const API = "https://apibay.org";

const MOVIE_CATS = new Set([201, 202, 207, 209]);
const TV_CATS = new Set([205, 208]);

const TOP_MOVIES = `${API}/precompiled/data_top100_207.json`;
const TOP_TV = `${API}/precompiled/data_top100_208.json`;

interface ApibayItem {
  id?: string;
  name?: string;
  info_hash?: string;
  seeders?: string;
  leechers?: string;
  num_files?: string;
  size?: string;
  added?: string;
  category?: string;
}

const ZERO_HASH = "0000000000000000000000000000000000000000";

function toResult(it: ApibayItem, source: SourceId): TorrentResult | null {
  const infoHash = (it.info_hash ?? "").toLowerCase();
  if (!infoHash || infoHash === ZERO_HASH || it.id === "0") return null;
  const name = it.name || "Unknown";
  const numFiles = Number(it.num_files);
  return {
    infoHash,
    name,
    sizeBytes: Number(it.size) || 0,
    seeders: Number(it.seeders) || 0,
    leechers: Number(it.leechers) || 0,
    numFiles: Number.isFinite(numFiles) && numFiles > 0 ? numFiles : undefined,
    source,
    magnet: buildMagnet(infoHash, name),
    added: Number(it.added) || undefined,
  };
}

async function fetchItems(url: string, opts: SearchOptions): Promise<ApibayItem[]> {
  const res = await fetchResilient(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: opts.signal,
    retries: 1,
  });
  if (!res.ok) throw new HttpError(res.status, `Pirate Bay returned ${res.status}`);
  const json = (await res.json()) as ApibayItem[];
  return Array.isArray(json) ? json : [];
}

async function search(
  query: string,
  cats: Set<number>,
  browseUrl: string,
  source: SourceId,
  opts: SearchOptions,
): Promise<TorrentResult[]> {
  const q = query.trim();
  const items = await fetchItems(
    q ? `${API}/q.php?q=${encodeURIComponent(q)}` : browseUrl,
    opts,
  );
  const out: TorrentResult[] = [];
  for (const it of items) {
    if (q && !cats.has(Number(it.category))) continue;
    const r = toResult(it, source);
    if (r) out.push(r);
  }
  return out;
}

export const tpbMovies: Source = {
  id: "tpb-movies",
  label: "TPB",
  group: "Movies",
  homepage: "https://thepiratebay.org",
  search: (query, opts = {}) => search(query, MOVIE_CATS, TOP_MOVIES, "tpb-movies", opts),
};

export const tpbTv: Source = {
  id: "tpb-tv",
  label: "TPB",
  group: "TV",
  homepage: "https://thepiratebay.org",
  search: (query, opts = {}) => search(query, TV_CATS, TOP_TV, "tpb-tv", opts),
};
