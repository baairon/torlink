import { promises as fs } from "node:fs";
import { configFile, defaultDownloadDir } from "./paths";
import { serializeWrites, writeJsonAtomic } from "../util/atomic";
import { DEFAULT_THEME, isThemeId, type ThemeId } from "../ui/theme";

export interface Config {
  downloadDir: string;
  trackers: string[];
  theme: ThemeId;
}

export const defaultConfig: Config = {
  downloadDir: defaultDownloadDir,
  trackers: [],
  theme: DEFAULT_THEME,
};

export async function loadConfig(): Promise<Config> {
  let raw: string;
  try {
    raw = await fs.readFile(configFile, "utf8");
  } catch {
    return { ...defaultConfig, trackers: [] };
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
      // An unknown theme falls back rather than failing the load: a config
      // written by a newer build must never brick an older one.
      theme: isThemeId(parsed.theme) ? parsed.theme : DEFAULT_THEME,
    };
    return cfg;
  } catch {
    return { ...defaultConfig, trackers: [] };
  }
}

const write = serializeWrites();

export function saveConfig(config: Config): Promise<void> {
  return write(() => writeJsonAtomic(configFile, config));
}
