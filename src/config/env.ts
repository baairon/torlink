import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { envFlag, envVar } from "./env-vars";

let loaded = false;

/** @internal Vitest only — avoids loading repo `.env` into isolated tests. */
export function resetEnvLoader(): void {
  loaded = false;
}

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  if (process.env.TORZLINK_DISABLE_DOTENV === "1") return;
  loadDotenv({ path: path.resolve(process.cwd(), ".env") });
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    loadDotenv({ path: path.resolve(here, "../../.env") });
  } catch {
    /* bundled */
  }
}

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  channelId: string;
}

export function telegramConfig(): TelegramConfig | null {
  loadEnv();
  const botToken = envVar("TELEGRAM_BOT_TOKEN") ?? "";
  const channelId = envVar("TELEGRAM_CHANNEL_ID") ?? "";
  const enabled = envFlag("TELEGRAM_ENABLED") || Boolean(botToken && channelId);
  if (!enabled || !botToken || !channelId) return null;
  return { enabled: true, botToken, channelId };
}

export function skipDependencyUpdate(): boolean {
  loadEnv();
  return (
    envFlag("TORZLINK_SKIP_UPDATE", "TORLNK_SKIP_UPDATE") ||
    envFlag("TORLNK_SKIP_UPDATE") ||
    process.env.CI === "true" ||
    process.env.CI === "1"
  );
}
