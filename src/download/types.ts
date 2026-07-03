import type { SourceId } from "../sources/types";
import type { FileInfo } from "./engine";

export type DownloadStatus = "downloading" | "paused" | "completed" | "failed";

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
  /** Indices of files the user turned off; empty/undefined means all files download. */
  deselected?: number[];
  /** Cached file list so paused/restored items can still show/edit selection
   * once the live torrent (and its engine-side file list) is gone. */
  fileList?: FileInfo[];
}
