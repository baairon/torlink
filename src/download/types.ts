import type { SourceId } from "../sources/types";

// "queued" = waiting for a free download slot (see TORLINK_MAX_DOWNLOADS). Unlike
// "paused" (an explicit user action) a queued item is started automatically as
// soon as a slot frees.
export type DownloadStatus = "downloading" | "queued" | "paused" | "completed" | "failed";

export type SeedStatus = "seeding" | "paused" | "missing";

export interface SeedItem {
  id: string;
  name: string;
  source?: SourceId;
  magnet: string;
  dir: string;
  sizeBytes: number;
  status: SeedStatus;
  uploadSpeed: number;
  uploaded: number;
  peers: number;
}

// One file inside a torrent, as offered to the exclude-before-download picker.
export interface TorrentFileEntry {
  index: number;
  name: string;
  length: number;
}

export interface QueueItem {
  id: string;
  name: string;
  source?: SourceId;
  magnet: string;
  dir: string;
  status: DownloadStatus;
  progress: number;
  totalBytes: number;
  downloadedBytes: number;
  speed: number;
  peers: number;
  eta?: number;
  files?: number;
  // File indices the user chose to skip before starting. Persisted so a resume
  // or retry re-applies the same exclusions when the engine re-adds the torrent.
  excludedFiles?: number[];
  error?: string;
  addedAt: number;
}
