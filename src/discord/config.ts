import type { Config } from "../config/config";

export interface ResolvedDiscord {
  webhookUrl?: string;
  botToken?: string;
  channelId?: string;
  allowedUserIds: string[];
  pollMs: number;
}

const DEFAULT_POLL_MS = 3000;
// Discord's own floor for polling a channel's messages is a few seconds; don't
// let a config value hammer the API below that.
const MIN_POLL_MS = 1500;

// Merge environment over the saved config, so a server can keep secrets out of
// the config file entirely. Env wins because it's the more deliberate,
// deployment-specific source.
export function resolveDiscord(cfg: Config, env: NodeJS.ProcessEnv = process.env): ResolvedDiscord {
  const d = cfg.discord;
  const pick = (envVal: string | undefined, fileVal: string | undefined): string | undefined =>
    envVal?.trim() || fileVal;
  const allowFromEnv = env.TORLINK_DISCORD_ALLOWED_USERS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    webhookUrl: pick(env.TORLINK_DISCORD_WEBHOOK, d?.webhookUrl),
    botToken: pick(env.TORLINK_DISCORD_BOT_TOKEN, d?.botToken),
    channelId: pick(env.TORLINK_DISCORD_CHANNEL, d?.channelId),
    allowedUserIds: allowFromEnv ?? d?.allowedUserIds ?? [],
    pollMs: Math.max(MIN_POLL_MS, d?.pollMs ?? DEFAULT_POLL_MS),
  };
}

// A webhook is enough to push notifications out.
export function canNotify(r: ResolvedDiscord): boolean {
  return !!r.webhookUrl;
}

// Commands additionally need a bot token + channel to read from, a webhook to
// answer through, and at least one allowed user. An empty allowlist means
// nobody is trusted to drive the daemon, so commands stay off.
export function canTakeCommands(r: ResolvedDiscord): boolean {
  return !!(r.botToken && r.channelId && r.webhookUrl) && r.allowedUserIds.length > 0;
}
