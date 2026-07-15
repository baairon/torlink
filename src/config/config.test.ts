import { describe, it, expect } from "vitest";
import { normalizeConfig, defaultConfig } from "./config";

describe("normalizeConfig", () => {
  it("falls back to defaults for junk", () => {
    expect(normalizeConfig(null)).toEqual({ ...defaultConfig, trackers: [] });
    expect(normalizeConfig("nope")).toEqual({ ...defaultConfig, trackers: [] });
  });
  it("keeps a valid downloadDir and filters non-string trackers", () => {
    const cfg = normalizeConfig({ downloadDir: "/srv/dl", trackers: ["udp://a", 5, "", "udp://b"] });
    expect(cfg.downloadDir).toBe("/srv/dl");
    expect(cfg.trackers).toEqual(["udp://a", "udp://b"]);
  });
  it("parses a discord block and trims strings", () => {
    const cfg = normalizeConfig({
      discord: {
        webhookUrl: " https://discord.com/api/webhooks/1/x ",
        botToken: "tok",
        channelId: "123",
        allowedUserIds: ["1", "", 2, "3"],
        pollMs: 5000,
      },
    });
    expect(cfg.discord).toEqual({
      webhookUrl: "https://discord.com/api/webhooks/1/x",
      botToken: "tok",
      channelId: "123",
      allowedUserIds: ["1", "3"],
      pollMs: 5000,
    });
  });
  it("drops an empty or malformed discord block", () => {
    expect(normalizeConfig({ discord: {} }).discord).toBeUndefined();
    expect(normalizeConfig({ discord: "x" }).discord).toBeUndefined();
    expect(normalizeConfig({ discord: { pollMs: -1, webhookUrl: 7 } }).discord).toBeUndefined();
  });
});
