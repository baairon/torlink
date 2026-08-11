import { promises as fs } from "node:fs";
import { configFile, defaultDownloadDir } from "./paths";
import { serializeWrites, writeJsonAtomic } from "../util/atomic";
import { parseRate } from "../util/format";

export interface Config {
  downloadDir: string;
  trackers: string[];
  /** Global download throttle in bytes/sec; 0 means unlimited. */
  downloadLimit: number;
  /** Global upload throttle in bytes/sec; 0 means unlimited. */
  uploadLimit: number;
}

export const defaultConfig: Config = {
  downloadDir: defaultDownloadDir,
  trackers: [],
  // Unthrottled, exactly as the app behaved before the setting existed.
  downloadLimit: 0,
  uploadLimit: 0,
};

// The environment gets a say, but only as the starting value: once the config
// file has a limit in it, that is the single source of truth, so a rate set
// with `r` is not silently overridden on the next launch. Same shape as
// TORLINK_MAX_DOWNLOADS, and the value takes the same units the prompt does
// ("5 MB/s", "512 KB/s", a bare number read as MB/s).
function envLimit(name: string): number {
  const raw = process.env[name];
  if (!raw) return 0;
  return parseRate(raw) ?? 0;
}

function rateField(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
}

function fresh(): Config {
  return {
    ...defaultConfig,
    trackers: [],
    downloadLimit: envLimit("TORLINK_DOWNLOAD_LIMIT"),
    uploadLimit: envLimit("TORLINK_UPLOAD_LIMIT"),
  };
}

export async function loadConfig(): Promise<Config> {
  let raw: string;
  try {
    raw = await fs.readFile(configFile, "utf8");
  } catch {
    return fresh();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Config>;
    const cfg: Config = {
      downloadDir:
        typeof parsed.downloadDir === "string" && parsed.downloadDir
          ? parsed.downloadDir
          : defaultDownloadDir,
      trackers: Array.isArray(parsed.trackers)
        ? parsed.trackers.filter((t): t is string => typeof t === "string" && t.length > 0)
        : [],
      // A missing or unreadable limit falls back rather than failing the load:
      // a config written by an older build must keep working.
      downloadLimit: rateField(parsed.downloadLimit, envLimit("TORLINK_DOWNLOAD_LIMIT")),
      uploadLimit: rateField(parsed.uploadLimit, envLimit("TORLINK_UPLOAD_LIMIT")),
    };
    return cfg;
  } catch {
    return fresh();
  }
}

const write = serializeWrites();

export function saveConfig(config: Config): Promise<void> {
  return write(() => writeJsonAtomic(configFile, config));
}
