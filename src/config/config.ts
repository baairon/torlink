import { promises as fs } from "node:fs";
import { configFile, defaultDownloadDir } from "./paths";
import { serializeWrites, writeJsonAtomic } from "../util/atomic";

export interface Config {
  downloadDir: string;
  trackers: string[];
  recentDirs: string[];
}

export const defaultConfig: Config = {
  downloadDir: defaultDownloadDir,
  trackers: [],
  recentDirs: [],
};

export async function loadConfig(): Promise<Config> {
  let raw: string;
  try {
    raw = await fs.readFile(configFile, "utf8");
  } catch {
    return { ...defaultConfig, trackers: [], recentDirs: [] };
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
      recentDirs: Array.isArray(parsed.recentDirs)
        ? parsed.recentDirs.filter((d): d is string => typeof d === "string" && d.length > 0)
        : [],
    };
    return cfg;
  } catch {
    return { ...defaultConfig, trackers: [], recentDirs: [] };
  }
}

// Pure MRU helper: prepend `dir`, drop an earlier duplicate, cap at `max`.
// Ignores a blank `dir` (returns `list` unchanged); never mutates `list`.
export function pushRecentDir(list: string[], dir: string, max = 8): string[] {
  if (!dir) return list;
  return [dir, ...list.filter((d) => d !== dir)].slice(0, max);
}

const write = serializeWrites();

export function saveConfig(config: Config): Promise<void> {
  return write(() => writeJsonAtomic(configFile, config));
}
