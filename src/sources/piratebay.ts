import { fetchResilient, HttpError, USER_AGENT } from "../util/net";
import { buildMagnet } from "./magnet";
import type { SearchOptions, Source, SourceId, TorrentResult } from "./types";

const API = "https://apibay.org";

const MOVIE_CATS = new Set([201, 202, 207, 209]);
const TV_CATS = new Set([205, 208]);

// Everything you read or listen to as a book: e-books (601), comics (602) and
// audio books (102). One tab rather than two — the format is already in the
// torrent's name, and splitting them would only ask the same sources twice.
const BOOK_CATS = new Set([601, 602, 102]);

const top = (cat: number): string => `${API}/precompiled/data_top100_${cat}.json`;

// Browse feeds, used when the query is empty. apibay publishes a top-100 per
// category; books need two of them, since 600 (Other) carries e-books and
// comics while audio books sit under Audio.
const TOP_MOVIES = [top(207)];
const TOP_TV = [top(208)];
const TOP_BOOKS = [top(600), top(102)];

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

// Browse can need more than one feed (books span Other and Audio). One feed
// answering is enough: a partial list beats reporting the whole source down.
async function fetchBrowse(urls: readonly string[], opts: SearchOptions): Promise<ApibayItem[]> {
  const settled = await Promise.allSettled(urls.map((u) => fetchItems(u, opts)));
  const ok = settled.filter((s) => s.status === "fulfilled");
  if (ok.length === 0) throw (settled[0] as PromiseRejectedResult).reason;
  return ok.flatMap((s) => (s as PromiseFulfilledResult<ApibayItem[]>).value);
}

async function search(
  query: string,
  cats: Set<number>,
  browseUrls: readonly string[],
  source: SourceId,
  opts: SearchOptions,
): Promise<TorrentResult[]> {
  const q = query.trim();
  const items = q
    ? await fetchItems(`${API}/q.php?q=${encodeURIComponent(q)}`, opts)
    : await fetchBrowse(browseUrls, opts);
  const out: TorrentResult[] = [];
  for (const it of items) {
    // Browse feeds are filtered as well as searches: 600 mixes e-books and
    // comics with everything else filed under Other. A row with no category at
    // all is kept — an unfiled row beats an empty tab.
    if (it.category && !cats.has(Number(it.category))) continue;
    const r = toResult(it, source);
    if (r) out.push(r);
  }
  return out;
}

export const tpbMovies: Source = {
  id: "tpb-movies",
  label: "TPB",
  groups: ["Movies"],
  homepage: "https://thepiratebay.org",
  reportsHealth: true,
  search: (query, opts = {}) => search(query, MOVIE_CATS, TOP_MOVIES, "tpb-movies", opts),
};

export const tpbTv: Source = {
  id: "tpb-tv",
  label: "TPB",
  groups: ["TV"],
  homepage: "https://thepiratebay.org",
  reportsHealth: true,
  search: (query, opts = {}) => search(query, TV_CATS, TOP_TV, "tpb-tv", opts),
};

export const tpbBooks: Source = {
  id: "tpb-books",
  label: "TPB",
  groups: ["Books"],
  homepage: "https://thepiratebay.org",
  reportsHealth: true,
  search: (query, opts = {}) => search(query, BOOK_CATS, TOP_BOOKS, "tpb-books", opts),
};
