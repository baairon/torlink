import { afterEach, describe, expect, it } from "vitest";
import {
  applyTheme,
  COLOR,
  currentTheme,
  currentThemeId,
  DEFAULT_THEME,
  isThemeId,
  paletteFor,
  rule,
  sourceStyle,
  THEMES,
  THEME_IDS,
} from "./theme";

afterEach(() => {
  applyTheme(DEFAULT_THEME);
});

// The colours torlink shipped with, before any of this existed. The default
// theme has to reproduce them exactly, or "no change unless you ask for one"
// is not true.
const BUILT_IN = {
  accent: "#a78bfa",
  text: "#e9e4f5",
  alt: "#b9a7e6",
  good: "#86d6a2",
  warn: "#f0c560",
  bad: "#ee7d92",
  bright: "#d8b4fe",
};

describe("the default theme", () => {
  it("reproduces the built-in palette exactly", () => {
    for (const [key, value] of Object.entries(BUILT_IN)) {
      expect(COLOR[key as keyof typeof BUILT_IN], key).toBe(value);
    }
  });

  it("keeps the built-in rule colour", () => {
    expect(rule()).toBe("#6b6577");
  });

  it("is what an unconfigured app starts on", () => {
    expect(currentThemeId()).toBe(DEFAULT_THEME);
    expect(THEMES[0]!.id).toBe(DEFAULT_THEME);
  });
});

describe("applyTheme", () => {
  it("repaints the shared palette in place, so live components follow", () => {
    const before = COLOR.accent;
    applyTheme("ocean");
    expect(COLOR.accent).not.toBe(before);
    expect(COLOR.accent).toBe("#38bdf8");
    // Same object identity: components hold a reference to COLOR, not a copy.
    expect(COLOR).toBe(COLOR);
  });

  it("moves the rule colour with the theme", () => {
    applyTheme("forest");
    expect(rule()).toBe("#3f6b52");
  });

  it("leaves the semantic colours alone — they mean something", () => {
    for (const id of THEME_IDS) {
      applyTheme(id);
      expect(COLOR.good, id).toBe(BUILT_IN.good);
      expect(COLOR.warn, id).toBe(BUILT_IN.warn);
      expect(COLOR.bad, id).toBe(BUILT_IN.bad);
    }
  });

  it("falls back to the default rather than throwing on an unknown id", () => {
    applyTheme("nonsense");
    expect(currentThemeId()).toBe(DEFAULT_THEME);
    expect(COLOR.accent).toBe(BUILT_IN.accent);
  });
});

describe("every palette", () => {
  it("defines all seven colours as hex", () => {
    for (const theme of THEMES) {
      for (const key of ["accent", "bright", "soft", "text", "rule", "deep", "shade"] as const) {
        expect(theme[key], `${theme.id}.${key}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("has a unique id and a name", () => {
    expect(new Set(THEME_IDS).size).toBe(THEMES.length);
    for (const theme of THEMES) expect(theme.name.length, theme.id).toBeGreaterThan(0);
  });

  it("keeps body text readable on black", () => {
    // Every palette is used on a dark terminal, so its body text has to clear
    // a brightness floor — this catches a palette whose text is too dim.
    for (const theme of THEMES) {
      const text = paletteFor(theme).text;
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(text.slice(i, i + 2), 16));
      const luma = (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
      expect(luma, `${theme.id} text ${text}`).toBeGreaterThan(0.6);
    }
  });

  it("is accepted by isThemeId, and nothing else is", () => {
    for (const id of THEME_IDS) expect(isThemeId(id)).toBe(true);
    for (const junk of ["", "Torlink", "purple", 3, null, undefined]) {
      expect(isThemeId(junk), String(junk)).toBe(false);
    }
  });
});

describe("source tags", () => {
  it("stay put across every palette, like the semantic colours", () => {
    // A tag answers "who found this row", which is a fact about the source and
    // not about the palette — and on Mono, tinting them toward one accent
    // would collapse them into the same grey.
    const before = THEME_IDS.map(() => sourceStyle("yts").color);
    for (const id of THEME_IDS) {
      applyTheme(id);
      expect(sourceStyle("yts").color, id).toBe(before[0]);
    }
    expect(sourceStyle("yts").color).not.toBe(sourceStyle("eztv").color);
  });

  it("still answers for an unknown or missing source", () => {
    expect(sourceStyle(undefined).tag).toBe("•");
    expect(sourceStyle("gone" as never).tag).toBe("•");
  });

  it("gives every variant of one site the same tag and colour", () => {
    // The tag answers "who found this row"; the tab already answers "what kind".
    expect(sourceStyle("tpb-movies")).toEqual(sourceStyle("tpb-tv"));
    expect(sourceStyle("x1337-movies")).toEqual(sourceStyle("x1337-tv"));
  });
});

describe("currentTheme", () => {
  it("returns the whole palette, not just its id", () => {
    applyTheme("amber");
    expect(currentTheme().name).toBe("Amber");
    expect(currentTheme().accent).toBe(COLOR.accent);
  });
});
