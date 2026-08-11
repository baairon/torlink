import { promises as fs } from "node:fs";
import { configFile, defaultDownloadDir } from "./paths";
import { serializeWrites, writeJsonAtomic } from "../util/atomic";

export interface Config {
  downloadDir: string;
  trackers: string[];
  /** Torrents allowed to download at once; 0 means no limit. */
  maxDownloads: number;
  /** Check the registry for a newer release, once per launch. */
  checkForUpdates: boolean;
}

/** The values maxDownloads cycles through in the settings pane. */
export const MAX_DOWNLOAD_CHOICES = [0, 1, 2, 3, 5, 8] as const;

// The environment still gets a say, but only as the starting value: once the
// config file exists it is the single source of truth, so a setting changed in
// the pane is not silently overridden on the next launch.
export function envMaxDownloads(): number {
  const v = Number(process.env.TORLINK_MAX_DOWNLOADS);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function envChecksUpdates(): boolean {
  return !process.env.TORLINK_NO_UPDATE_CHECK;
}

function count(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

// A function, not a constant: both defaults are read from the environment,
// which a test (or the user) can change between calls.
export function defaultConfig(): Config {
  return {
    downloadDir: defaultDownloadDir,
    trackers: [],
    maxDownloads: envMaxDownloads(),
    checkForUpdates: envChecksUpdates(),
  };
}

export async function loadConfig(): Promise<Config> {
  let raw: string;
  try {
    raw = await fs.readFile(configFile, "utf8");
  } catch {
    return defaultConfig();
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
      // An unknown or missing value falls back rather than failing the load: a
      // config written by a newer build must never brick an older one.
      maxDownloads: count(parsed.maxDownloads, envMaxDownloads()),
      checkForUpdates: bool(parsed.checkForUpdates, envChecksUpdates()),
    };
    return cfg;
  } catch {
    return defaultConfig();
  }
}

const write = serializeWrites();

export function saveConfig(config: Config): Promise<void> {
  return write(() => writeJsonAtomic(configFile, config));
}
