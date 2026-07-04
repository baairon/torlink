export type SourceId =
  | "fitgirl"
  | "yts"
  | "eztv"
  | "nyaa"
  | "subsplease"
  | "tpb-movies"
  | "tpb-tv"
  | "x1337-movies"
  | "x1337-tv";

export type SourceGroup = "Games" | "Movies" | "TV" | "Anime";

export interface TorrentResult {
  infoHash: string;
  name: string;
  sizeBytes: number;
  seeders: number;
  leechers: number;
  numFiles?: number;
  source: SourceId;
  magnet: string;
  added?: number;
}

export interface SearchOptions {
  signal?: AbortSignal;
}

export interface Source {
  id: SourceId;
  label: string;
  group: SourceGroup;
  homepage: string;
  search(query: string, opts?: SearchOptions): Promise<TorrentResult[]>;
}
