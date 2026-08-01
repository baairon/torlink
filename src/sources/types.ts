export type SourceId =
  | "fitgirl"
  | "yts"
  | "eztv"
  | "nyaa"
  | "nyaa-ebooks"
  | "subsplease"
  | "tpb-movies"
  | "tpb-tv"
  | "tpb-audiobooks"
  | "tpb-ebooks"
  | "x1337-movies"
  | "x1337-tv"
  | "x1337-ebooks"
  | "x1337-audiobooks"
  | "bittorrented";

export type SourceGroup = "Games" | "Movies" | "TV" | "Anime" | "E-Books" | "Audiobooks";

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
  // The category tabs a source feeds. Most sources belong to one; a general
  // index can feed several. A source with none shows under the All tab only.
  groups?: readonly SourceGroup[];
  homepage: string;
  // True when the source returns real swarm counts. False when its feed has
  // none, so seeders: 0 means unknown, not dead (the alive-only filter must
  // never drop those rows).
  reportsHealth: boolean;
  search(query: string, opts?: SearchOptions): Promise<TorrentResult[]>;
}
