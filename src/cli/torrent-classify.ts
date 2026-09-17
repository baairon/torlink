import { readFile } from "node:fs/promises";
import path from "node:path";
import parseTorrent from "parse-torrent";

export type TorrentType = "video" | "audio" | "unknown";

export interface TorrentClassification {
  type: TorrentType;
  audioBytes: number;
  videoBytes: number;
  totalBytes: number;
}

type TorrentMetadata = {
  files?: Array<{ name?: string; path?: string; length: number }>;
  name?: string;
  length?: number;
};

const VIDEO_EXTENSIONS = new Set([".mkv", ".mp4", ".avi", ".m4v", ".mov", ".wmv", ".ts", ".m2ts"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".wav", ".wma"]);

export function classifyTorrent(metadata: TorrentMetadata): TorrentClassification {
  let audioBytes = 0;
  let videoBytes = 0;
  let totalBytes = 0;
  for (const file of metadata.files ?? []) {
    const bytes = Number(file.length);
    if (!Number.isFinite(bytes) || bytes < 0) continue;
    totalBytes += bytes;
    const extension = path.extname(file.path ?? file.name ?? "").toLowerCase();
    if (VIDEO_EXTENSIONS.has(extension)) videoBytes += bytes;
    else if (AUDIO_EXTENSIONS.has(extension)) audioBytes += bytes;
  }
  const type: TorrentType = videoBytes > audioBytes && videoBytes > 0
    ? "video"
    : audioBytes > videoBytes && audioBytes > 0
      ? "audio"
      : "unknown";
  return { type, audioBytes, videoBytes, totalBytes };
}

export async function classifyTorrentFile(torrentPath: string): Promise<TorrentClassification> {
  const metadata = await parseTorrent(new Uint8Array(await readFile(torrentPath)));
  if (!Array.isArray(metadata.files) || metadata.files.length === 0) {
    throw new Error("Torrent metadata contains no file list");
  }
  return classifyTorrent(metadata);
}

export function watchDirForClassification(
  classification: TorrentClassification,
  defaultWatchDir: string,
  musicWatchDir = process.env.QBIT_MUSIC_WATCH_DIR?.trim(),
): string {
  return classification.type === "audio" && musicWatchDir ? musicWatchDir : defaultWatchDir;
}

export function classificationSummary(classification: TorrentClassification): string {
  if (classification.type === "unknown") return "Torrent classification UNKNOWN";
  const bytes = classification.type === "audio" ? classification.audioBytes : classification.videoBytes;
  const percent = classification.totalBytes > 0 ? (bytes / classification.totalBytes) * 100 : 0;
  return `Torrent classified ${classification.type.toUpperCase()} (${percent.toFixed(1)}% ${classification.type})`;
}
