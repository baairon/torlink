import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { loadEnv, resetEnvLoader, telegramConfig, skipDependencyUpdate } from "../../src/config/env";

describe("loadEnv / telegramConfig", () => {
  const keys = [
    "TELEGRAM_ENABLED",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHANNEL_ID",
    "TORZLINK_SKIP_UPDATE",
    "TORLNK_SKIP_UPDATE",
    "CI",
  ] as const;
  const saved: Partial<Record<(typeof keys)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const k of keys) saved[k] = process.env[k];
    for (const k of keys) delete process.env[k];
    resetEnvLoader();
    process.env.TORZLINK_DISABLE_DOTENV = "1";
    loadEnv();
  });

  afterEach(() => {
    delete process.env.TORZLINK_DISABLE_DOTENV;
    resetEnvLoader();
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("returns null when Telegram is not configured", () => {
    expect(telegramConfig()).toBeNull();
  });

  it("parses Telegram config when enabled with token and channel", () => {
    process.env.TELEGRAM_ENABLED = "1";
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    process.env.TELEGRAM_CHANNEL_ID = "@channel";
    expect(telegramConfig()).toEqual({
      enabled: true,
      botToken: "123:abc",
      channelId: "@channel",
    });
  });

  it("honors TORZLINK_SKIP_UPDATE and legacy TORLNK_SKIP_UPDATE", () => {
    expect(skipDependencyUpdate()).toBe(false);
    process.env.TORZLINK_SKIP_UPDATE = "1";
    expect(skipDependencyUpdate()).toBe(true);
    delete process.env.TORZLINK_SKIP_UPDATE;
    process.env.TORLNK_SKIP_UPDATE = "1";
    expect(skipDependencyUpdate()).toBe(true);
  });
});
