import { fetchResilient, HttpError, USER_AGENT } from "../util/net";
import type { SearchOptions, Source, TorrentResult } from "./types";
import { buildMagnet } from "./magnet";

export interface SolidTorrentResponse {
  success: boolean;
  query: string;
  results: {
    id: string;
    infohash: string;
    title: string;
    size: number;
    category: number;
    subCategory?: number | null;
    seeders: number;
    leechers: number;
    downloads: number;
    verified: boolean;
    createdAt?: string;
    updatedAt?: string;
  }[];
  pagination: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  took: number;
}

const MAX_DETAILS = 10;


export function mapSolidResponse(data: SolidTorrentResponse, sourceId: string): TorrentResult[] {
  if (!data.success || !data.results) {
    return [];
  }
  
  const rows = data.results.slice(0, MAX_DETAILS);
  
  return rows.map((r): TorrentResult => {
    // SolidTorrents returns uppercase infohash, buildMagnet handles it fine but standardizing is good
    const infoHash = r.infohash.toLowerCase();
    
    // Convert dates if available
    let addedTime: number | undefined;
    const timeStr = r.createdAt || r.updatedAt;
    if (timeStr) {
      const ms = Date.parse(timeStr);
      if (!isNaN(ms)) {
        addedTime = ms;
      }
    }

    return {
      infoHash,
      name: r.title,
      sizeBytes: r.size,
      seeders: r.seeders,
      leechers: r.leechers,
      source: sourceId as any,
      magnet: buildMagnet(infoHash, r.title),
      added: addedTime,
    };
  });
}

async function search(
  query: string,
  sourceId: string,
  opts: SearchOptions = {},
): Promise<TorrentResult[]> {
  const q = query.trim();
  if (!q) return [];

  const searchUrl = `https://solidtorrents.to/api/v1/search?q=${encodeURIComponent(q)}`;
  
  const res = await fetchResilient(searchUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "application/json"
    },
    signal: opts.signal,
    retries: 2,
  });

  if (!res.ok) throw new HttpError(res.status, `SolidTorrents returned ${res.status}`);
  
  const data = await res.json() as SolidTorrentResponse;
  
  return mapSolidResponse(data, sourceId);
}

export const solidMovies: Source = {
  id: "solid-movies" as any,
  label: "SolidTorrents",
  group: "Movies",
  homepage: "https://solidtorrents.to",
  search: (query, opts) => search(query, "solid-movies", opts),
};

export const solidTv: Source = {
  id: "solid-tv" as any,
  label: "SolidTorrents",
  group: "TV",
  homepage: "https://solidtorrents.to",
  search: (query, opts) => search(query, "solid-tv", opts),
};

export const solidGames: Source = {
  id: "solid-games" as any,
  label: "SolidTorrents",
  group: "Games",
  homepage: "https://solidtorrents.to",
  search: (query, opts) => search(query, "solid-games", opts),
};

export const solidAnime: Source = {
  id: "solid-anime" as any,
  label: "SolidTorrents",
  group: "Anime",
  homepage: "https://solidtorrents.to",
  search: (query, opts) => search(query, "solid-anime", opts),
};
