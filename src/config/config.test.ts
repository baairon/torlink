import { describe, expect, it } from "vitest";
import { defaultConfig, loadConfig, normalizeSubtitleLang, saveConfig } from "./config";

describe("normalizeSubtitleLang", () => {
  it("keeps a valid 2-3 letter code, lowercased and trimmed", () => {
    expect(normalizeSubtitleLang("en")).toBe("en");
    expect(normalizeSubtitleLang(" HE ")).toBe("he");
    expect(normalizeSubtitleLang("SPA")).toBe("spa");
  });

  it("falls back to en for anything else", () => {
    expect(normalizeSubtitleLang("")).toBe("en");
    expect(normalizeSubtitleLang("e")).toBe("en");
    expect(normalizeSubtitleLang("engl")).toBe("en");
    expect(normalizeSubtitleLang("e1")).toBe("en");
    expect(normalizeSubtitleLang(42)).toBe("en");
    expect(normalizeSubtitleLang(null)).toBe("en");
    expect(normalizeSubtitleLang(undefined)).toBe("en");
  });
});

describe("config round-trip", () => {
  it("defaults subtitleLang to en", () => {
    expect(defaultConfig.subtitleLang).toBe("en");
  });

  it("persists subtitleLang through save and load", async () => {
    await saveConfig({ ...defaultConfig, subtitleLang: "he" });
    await expect(loadConfig()).resolves.toMatchObject({ subtitleLang: "he" });
  });

  it("rejects junk subtitleLang back to en on load", async () => {
    await saveConfig({ ...defaultConfig, subtitleLang: "not-a-code" });
    await expect(loadConfig()).resolves.toMatchObject({ subtitleLang: "en" });
  });
});
