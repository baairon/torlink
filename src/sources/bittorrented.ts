import { fetchResilient, HttpError, USER_AGENT } from "../util/net";
import { buildMagnet } from "./magnet";
import type { SearchOptions, Source, SourceGroup, SourceId, TorrentResult } from "./types";

// BitTorrented is a general index (its own library plus a large DHT crawl) with a
// media-type filter (audio/video/ebook/document/other). torlink surfaces those as
// their own tabs, so it's registered once per type. Its JSON API returns real
// swarm counts, so reportsHealth is true.
const BASE = "https://bittorrented.com";

// The index requires a real query (the API rejects fewer than 3 characters), so
// an empty browse returns nothing rather than erroring.
const MIN_QUERY = 3;

// bittorrented's `type` values (its media categories). Anything else 400s.
export type BtMediaType = "video" | "audio" | "ebook" | "xxx" | "other";

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

// Build a BitTorrented source scoped to one media type. Each shares the search
// logic and differs only by the `type` filter, its id, label, and tab group.
function makeSource(
  id: SourceId,
  label: string,
  group: SourceGroup,
  type: BtMediaType,
): Source {
  async function search(query: string, opts: SearchOptions = {}): Promise<TorrentResult[]> {
    const q = query.trim();
    if (q.length < MIN_QUERY) return [];

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

  return { id, label, group, homepage: BASE, reportsHealth: true, search };
}

export const bittorrentedVideo = makeSource("bt-video", "BitTorrented", "Video", "video");
export const bittorrentedAudio = makeSource("bt-audio", "BitTorrented", "Music", "audio");
export const bittorrentedEbook = makeSource("bt-ebook", "BitTorrented", "Books", "ebook");
export const bittorrentedXxx = makeSource("bt-xxx", "BitTorrented", "XXX", "xxx");
export const bittorrentedOther = makeSource("bt-other", "BitTorrented", "Other", "other");

export const bittorrentedSources = [
  bittorrentedVideo,
  bittorrentedAudio,
  bittorrentedEbook,
  bittorrentedXxx,
  bittorrentedOther,
];
