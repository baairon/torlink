import type { SourceId } from "../sources/types";

export type QueueStatus = "downloading" | "paused" | "failed";

export interface PeerInfo {
  ip: string;
  client: string;
  peerId: string;
  downloaded: number;
  uploaded: number;
  downSpeed: number;
  upSpeed: number;
}

export type DownloadStatus = "downloading" | "paused" | "completed" | "failed";

export type SeedStatus = "seeding" | "paused" | "missing";

export interface TorrentFileInfo {
  path: string;
  length: number;
  downloaded: number;
  selected: boolean;
}

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
  error?: string;
  addedAt: number;
}
