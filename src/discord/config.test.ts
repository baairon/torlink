import { describe, it, expect } from "vitest";
import { resolveDiscord, canNotify, canTakeCommands } from "./config";
import type { Config } from "../config/config";

const base: Config = { downloadDir: "/dl", trackers: [] };

describe("resolveDiscord", () => {
  it("uses the file config when the env is empty", () => {
    const cfg: Config = {
      ...base,
      discord: { webhookUrl: "hook", botToken: "tok", channelId: "c1", allowedUserIds: ["u1"] },
    };
    const r = resolveDiscord(cfg, {});
    expect(r).toMatchObject({ webhookUrl: "hook", botToken: "tok", channelId: "c1", allowedUserIds: ["u1"] });
    expect(r.pollMs).toBe(3000);
  });
  it("lets env override the file", () => {
    const cfg: Config = { ...base, discord: { webhookUrl: "file-hook", channelId: "old" } };
    const r = resolveDiscord(cfg, {
      TORLINK_DISCORD_WEBHOOK: "env-hook",
      TORLINK_DISCORD_CHANNEL: "new",
      TORLINK_DISCORD_ALLOWED_USERS: "a, b ,,c",
    });
    expect(r.webhookUrl).toBe("env-hook");
    expect(r.channelId).toBe("new");
    expect(r.allowedUserIds).toEqual(["a", "b", "c"]);
  });
  it("clamps the poll interval to the floor", () => {
    const cfg: Config = { ...base, discord: { pollMs: 100 } };
    expect(resolveDiscord(cfg, {}).pollMs).toBe(1500);
  });
});

describe("capabilities", () => {
  it("notifies with just a webhook", () => {
    expect(canNotify(resolveDiscord({ ...base, discord: { webhookUrl: "h" } }, {}))).toBe(true);
    expect(canNotify(resolveDiscord(base, {}))).toBe(false);
  });
  it("takes commands only with token + channel + webhook + an allowlisted user", () => {
    const full: Config = {
      ...base,
      discord: { webhookUrl: "h", botToken: "t", channelId: "c", allowedUserIds: ["u"] },
    };
    expect(canTakeCommands(resolveDiscord(full, {}))).toBe(true);
    // missing allowlist
    const noAllow: Config = { ...base, discord: { webhookUrl: "h", botToken: "t", channelId: "c" } };
    expect(canTakeCommands(resolveDiscord(noAllow, {}))).toBe(false);
    // missing bot token
    const noTok: Config = { ...base, discord: { webhookUrl: "h", channelId: "c", allowedUserIds: ["u"] } };
    expect(canTakeCommands(resolveDiscord(noTok, {}))).toBe(false);
  });
});
