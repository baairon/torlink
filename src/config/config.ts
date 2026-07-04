import { promises as fs } from "node:fs";
import { configFile } from "./paths";
import { serializeWrites, writeJsonAtomic } from "../util/atomic";

export interface DelugeConfig {
  url: string;
  password: string;
}

export interface Config {
  deluge: DelugeConfig | null;
}

export const defaultConfig: Config = {
  deluge: null,
};

function parseDeluge(raw: unknown): DelugeConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.url !== "string" || !r.url) return null;
  if (typeof r.password !== "string") return null;
  return { url: r.url, password: r.password };
}

export async function loadConfig(): Promise<Config> {
  let raw: string;
  try {
    raw = await fs.readFile(configFile, "utf8");
  } catch {
    return { ...defaultConfig };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Config>;
    return { deluge: parseDeluge(parsed.deluge) };
  } catch {
    return { ...defaultConfig };
  }
}

const write = serializeWrites();

export function saveConfig(config: Config): Promise<void> {
  return write(() => writeJsonAtomic(configFile, config));
}
