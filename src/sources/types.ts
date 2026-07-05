export type SourceId =
  | "fitgirl"
  | "yts"
  | "eztv"
  | "nyaa"
  | "subsplease"
  | "tpb-movies"
  | "tpb-tv"
  | "x1337-movies"
  | "x1337-tv"
  | "dontorrent-movies"
  | "dontorrent-tv";

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
  // True when the source returns real swarm counts. False when its feed has
  // none, so seeders: 0 means unknown, not dead (the alive-only filter must
  // never drop those rows).
  reportsHealth: boolean;
  search(query: string, opts?: SearchOptions): Promise<TorrentResult[]>;
}
