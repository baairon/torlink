import { fetchResilient, HttpError, USER_AGENT } from "../util/net";
import { buildMagnet } from "./magnet";
import type { SearchOptions, Source, SourceId, TorrentResult } from "./types";

// BitTorrented is a general index (its own library plus a large DHT crawl).
// torlink asks it one media type per tab: video for Movies and TV, audio for
// Music. Anime stays with its dedicated sources (the API can't tell anime from
// any other video) and Games stays FitGirl's alone. Its JSON API returns real swarm counts, so
// reportsHealth is true.
const BASE = "https://bittorrented.com";

// The index requires a real query (the API rejects fewer than 3 characters), so
// an empty browse returns nothing rather than erroring.
const MIN_QUERY = 3;

interface BtResult {
  torrent_infohash?: string;
  torrent_name?: string;
  torrent_total_size?: number;
  torrent_seeders?: number | null;
  torrent_leechers?: number | null;
  torrent_file_count?: number;
  torrent_created_at?: string;
}

interface BtResponse {
  results?: BtResult[];
}

function toUnixSeconds(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
}

// Map the API rows to torlink results. Pure and exported so the mapping is tested
// without a live request. Rows without a valid 40-char info hash are dropped (a
// magnet needs one).
export function mapBittorrentedResults(results: BtResult[], id: SourceId): TorrentResult[] {
  const out: TorrentResult[] = [];
  for (const r of results) {
    const infoHash = r.torrent_infohash?.toLowerCase();
    if (!infoHash || !/^[a-f0-9]{40}$/.test(infoHash)) continue;
    const name = r.torrent_name || infoHash;
    out.push({
      infoHash,
      name,
      sizeBytes: r.torrent_total_size ?? 0,
      seeders: r.torrent_seeders ?? 0,
      leechers: r.torrent_leechers ?? 0,
      numFiles: r.torrent_file_count,
      source: id,
      magnet: buildMagnet(infoHash, name),
      added: toUnixSeconds(r.torrent_created_at),
    });
  }
  return out;
}

// The API's own type names. It rejects anything else with a 400, so these are
// the ones the registry can ask for.
type MediaType = "video" | "audio";

async function search(
  query: string,
  type: MediaType,
  id: SourceId,
  opts: SearchOptions = {},
): Promise<TorrentResult[]> {
  const q = query.trim();
  if (q.length < MIN_QUERY) return [];

  // One media type per request, so a tab structurally cannot show another's
  // rows. One request per search.
  const params = new URLSearchParams({
    q,
    type,
    limit: "50",
    sortBy: "seeders",
    sortOrder: "desc",
  });
  const res = await fetchResilient(`${BASE}/api/search/torrents?${params.toString()}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: opts.signal,
    retries: 1,
  });
  if (!res.ok) throw new HttpError(res.status, `BitTorrented returned ${res.status}`);

  const json = (await res.json()) as BtResponse;
  return mapBittorrentedResults(json.results ?? [], id);
}

export const bittorrented: Source = {
  id: "bittorrented",
  label: "BitTorrented",
  groups: ["Movies", "TV"],
  homepage: BASE,
  reportsHealth: true,
  search: (query, opts = {}) => search(query, "video", "bittorrented", opts),
};

export const bittorrentedAudio: Source = {
  id: "bittorrented-audio",
  label: "BitTorrented",
  groups: ["Music"],
  homepage: BASE,
  reportsHealth: true,
  search: (query, opts = {}) => search(query, "audio", "bittorrented-audio", opts),
};
