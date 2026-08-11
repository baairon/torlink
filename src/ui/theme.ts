import type { SourceId } from "../sources/types";

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function lerpHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const c = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
}

/**
 * A palette is seven colours. Everything the UI paints comes from them, so
 * adding one is a table entry rather than a code change.
 *
 * `torlink` is the built-in pastel violet, spelled out from the exact hexes
 * the app has always used, so selecting it repaints nothing. The rest are
 * alternatives; the default is unchanged.
 */
export interface Theme {
  id: string;
  name: string;
  /** The cursor, the selected row, the bar's midpoint. */
  accent: string;
  /** The gradient's light end: the brightest tone in the palette. */
  bright: string;
  /** A softened accent, for secondary text. */
  soft: string;
  /**
   * Body text: light enough to read on black, tinted enough that the theme
   * shows in prose and not only in the highlights. Spelled out rather than
   * derived — the built-in #e9e4f5 is not any single wash of #a78bfa toward
   * white (its blue channel goes down, not up), and reproducing the default
   * exactly matters more than saving a table column.
   */
  text: string;
  /** Panel borders and rules. */
  rule: string;
  /** The gradient's dark end, under the accent. */
  deep: string;
  /** Darker still: the wordmark's shaded foot. */
  shade: string;
}

export const THEMES: readonly Theme[] = [
  {
    id: "torlink",
    name: "torlink",
    accent: "#a78bfa",
    bright: "#d8b4fe",
    soft: "#b9a7e6",
    text: "#e9e4f5",
    rule: "#6b6577",
    deep: "#7c5cd6",
    shade: "#4c3a8a",
  },
  {
    id: "rose",
    name: "Rose",
    accent: "#f472b6",
    bright: "#fbcfe8",
    soft: "#e5a3c4",
    text: "#fde3f0",
    rule: "#7a4a63",
    deep: "#db2777",
    shade: "#8a1f4c",
  },
  {
    id: "ocean",
    name: "Ocean",
    accent: "#38bdf8",
    bright: "#a5e8ff",
    soft: "#8ec4de",
    text: "#d7f2fe",
    rule: "#3f5f73",
    deep: "#0284c7",
    shade: "#1e4a6b",
  },
  {
    id: "forest",
    name: "Forest",
    accent: "#4ade80",
    bright: "#bbf7d0",
    soft: "#9bd4ae",
    text: "#dbf8e6",
    rule: "#3f6b52",
    deep: "#16a34a",
    shade: "#14532d",
  },
  {
    id: "amber",
    name: "Amber",
    accent: "#fbbf24",
    bright: "#fde68a",
    soft: "#d8b878",
    text: "#fef2d3",
    rule: "#7a6338",
    deep: "#d97706",
    shade: "#78350f",
  },
  {
    id: "ember",
    name: "Ember",
    accent: "#fb7185",
    bright: "#fecdd3",
    soft: "#dda3ad",
    text: "#fee3e7",
    rule: "#7a4048",
    deep: "#e11d48",
    shade: "#881337",
  },
  {
    id: "mono",
    name: "Mono",
    accent: "#d4d4d8",
    bright: "#f4f4f5",
    soft: "#a1a1aa",
    text: "#f6f6f7",
    rule: "#5f5f66",
    deep: "#a1a1aa",
    shade: "#52525b",
  },
  {
    id: "midnight",
    name: "Midnight",
    accent: "#818cf8",
    bright: "#c7d2fe",
    soft: "#9aa2d8",
    text: "#e6e8fe",
    rule: "#4a4f7a",
    deep: "#4f46e5",
    shade: "#312e81",
  },
];

export type ThemeId = string;

export const THEME_IDS: readonly string[] = THEMES.map((t) => t.id);

export const DEFAULT_THEME = "torlink";

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === "string" && THEME_IDS.includes(v);
}

function themeById(id: ThemeId): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!;
}

// Seeders green, warnings amber, failures red: these read as meaning, not as
// decoration, so they stay put while the palette moves around them.
const GOOD = "#86d6a2";
const WARN = "#f0c560";
const BAD = "#ee7d92";

export interface Palette {
  accent: string;
  text: string;
  alt: string;
  good: string;
  warn: string;
  bad: string;
  bright: string;
  /** The gradient's dark end, and the wordmark's shaded foot. */
  deep: string;
  shade: string;
}

export function paletteFor(theme: Theme): Palette {
  return {
    accent: theme.accent,
    text: theme.text,
    alt: theme.soft,
    good: GOOD,
    warn: WARN,
    bad: BAD,
    bright: theme.bright,
    deep: theme.deep,
    shade: theme.shade,
  };
}

// One mutable object rather than a React context: every component reads
// COLOR.* at render time, so a theme switch only has to re-render the tree —
// and the theme lives in Config, so setConfig already does that. A context
// would mean touching every component file for no behavioural gain in a
// single-process TUI.
export const COLOR: Palette = paletteFor(themeById(DEFAULT_THEME));

let activeTheme: ThemeId = DEFAULT_THEME;

export function currentThemeId(): ThemeId {
  return activeTheme;
}

export function currentTheme(): Theme {
  return themeById(activeTheme);
}

/** Repaints the shared palette in place. Callers must re-render afterwards. */
export function applyTheme(id: ThemeId): void {
  const theme = themeById(id);
  activeTheme = theme.id;
  Object.assign(COLOR, paletteFor(theme));
}

/**
 * Panel borders and rules.
 *
 * A function, not a constant: the old `RULE` and `ACCENT_RAMP` constants read
 * COLOR once at import time, which is before any saved theme is applied — they
 * would hold the default palette forever after a switch.
 */
export function rule(): string {
  return currentTheme().rule;
}

/** The two-stop accent ramp, read at call time so it follows the theme. */
export function accentRamp(): readonly [string, string] {
  return [COLOR.accent, COLOR.bright];
}

export const ICON = {
  done: "✓",
  error: "✗",
  pending: "·",
  pointer: "❯",
  dot: "·",
  warn: "⚠",
  bar: "▌",
  down: "↓",
  up: "↑",
  peer: "•",
  pause: "⏸",
} as const;

export const GUTTER = 2;

// Fixed hues, like the semantic colours above and for the same reason: a tag
// answers "who found this row", which is a fact about the source and not about
// the palette. They also have to stay tellable apart from each other, and
// tinting them all toward one accent would collapse them on Mono.
export const SOURCE_STYLE: Record<SourceId, { tag: string; color: string }> = {
  fitgirl: { tag: "FG", color: "#a78bfa" },
  yts: { tag: "YTS", color: "#86d6a2" },
  eztv: { tag: "EZTV", color: "#f0c560" },
  nyaa: { tag: "NYAA", color: "#d8b4fe" },
  subsplease: { tag: "SUB", color: "#b9a7e6" },
  "tpb-movies": { tag: "TPB", color: "#5fd0c5" },
  "tpb-tv": { tag: "TPB", color: "#5fd0c5" },
  "x1337-movies": { tag: "1337", color: "#f6a55c" },
  "x1337-tv": { tag: "1337", color: "#f6a55c" },
  bittorrented: { tag: "BT", color: "#7db8f0" },
};

// Tolerant lookup: a source id may be absent (a pasted magnet / bare infohash) or
// no longer exist (a removed source persisted in old history/seeds). Fall back to a
// neutral tag rather than indexing and crashing on `undefined`.
export function sourceStyle(id?: SourceId): { tag: string; color: string } {
  const s = id ? (SOURCE_STYLE as Record<string, { tag: string; color: string }>)[id] : undefined;
  return s ?? { tag: "•", color: COLOR.alt };
}
