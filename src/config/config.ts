import { promises as fs } from "node:fs";
import { configFile, defaultDownloadDir } from "./paths";
import { serializeWrites, writeJsonAtomic } from "../util/atomic";

// Optional Discord bridge. A webhook alone covers notifications (outbound);
// commands additionally need a bot token to read the channel plus an allowlist
// of who may drive it. Secrets can also come from the environment (see
// resolveDiscord) so a server never has to keep them in the config file.
export interface DiscordConfig {
  webhookUrl?: string;
  botToken?: string;
  channelId?: string;
  allowedUserIds?: string[];
  pollMs?: number;
}

export interface Config {
  downloadDir: string;
  trackers: string[];
  discord?: DiscordConfig;
}

export const defaultConfig: Config = {
  downloadDir: defaultDownloadDir,
  trackers: [],
};

function parseDiscord(raw: unknown): DiscordConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const d = raw as Record<string, unknown>;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  const discord: DiscordConfig = {
    webhookUrl: str(d.webhookUrl),
    botToken: str(d.botToken),
    channelId: str(d.channelId),
    allowedUserIds: Array.isArray(d.allowedUserIds)
      ? d.allowedUserIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : undefined,
    pollMs: typeof d.pollMs === "number" && d.pollMs > 0 ? d.pollMs : undefined,
  };
  // Drop the block entirely when nothing survived, so an empty object doesn't
  // linger in the file.
  return Object.values(discord).some((v) => v !== undefined) ? discord : undefined;
}

function hasSecret(cfg: Config): boolean {
  return !!(cfg.discord?.botToken || cfg.discord?.webhookUrl);
}

// Coerce whatever was in the file into a valid Config, dropping anything of the
// wrong shape. Pure, so the parsing rules are testable without touching disk.
export function normalizeConfig(parsed: unknown): Config {
  if (!parsed || typeof parsed !== "object") return { ...defaultConfig, trackers: [] };
  const p = parsed as Partial<Config>;
  return {
    downloadDir:
      typeof p.downloadDir === "string" && p.downloadDir ? p.downloadDir : defaultDownloadDir,
    trackers: Array.isArray(p.trackers)
      ? p.trackers.filter((t): t is string => typeof t === "string" && t.length > 0)
      : [],
    discord: parseDiscord(p.discord),
  };
}

export async function loadConfig(): Promise<Config> {
  let raw: string;
  try {
    raw = await fs.readFile(configFile, "utf8");
  } catch {
    return { ...defaultConfig, trackers: [] };
  }
  try {
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return { ...defaultConfig, trackers: [] };
  }
}

const write = serializeWrites();

export function saveConfig(config: Config): Promise<void> {
  // A stored bot token / webhook is a real credential, so keep the file to the
  // owner when it carries one.
  const mode = hasSecret(config) ? 0o600 : undefined;
  return write(() => writeJsonAtomic(configFile, config, { mode }));
}
