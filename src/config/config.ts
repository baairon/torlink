import { promises as fs } from "node:fs";
import { configFile, defaultDownloadDir } from "./paths";
import { serializeWrites, writeJsonAtomic } from "../util/atomic";

export interface Config {
  downloadDir: string;
  trackers: string[];
  subtitleLang: string;
}

export const defaultConfig: Config = {
  downloadDir: defaultDownloadDir,
  trackers: [],
  subtitleLang: "en",
};

// Accept only a plausible ISO 639 code (2-3 ASCII letters); anything else
// falls back to English rather than poisoning every subtitle search.
export function normalizeSubtitleLang(value: unknown): string {
  if (typeof value !== "string") return "en";
  const lang = value.trim().toLowerCase();
  return /^[a-z]{2,3}$/.test(lang) ? lang : "en";
}

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
      subtitleLang: normalizeSubtitleLang(parsed.subtitleLang),
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
