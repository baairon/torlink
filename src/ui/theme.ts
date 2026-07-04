import type { SourceId } from "../sources/types";

export const COLOR = {
  accent: "#a78bfa",
  text: "#e9e4f5",
  alt: "#b9a7e6",
  good: "#86d6a2",
  warn: "#f0c560",
  bad: "#ee7d92",
  bright: "#d8b4fe",
} as const;

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

export const RULE = "#6b6577";

export const GUTTER = 2;

export const SOURCE_STYLE: Record<SourceId, { tag: string; color: string }> = {
  fitgirl: { tag: "FG", color: COLOR.accent },
  yts: { tag: "YTS", color: COLOR.good },
  eztv: { tag: "EZTV", color: COLOR.warn },
  nyaa: { tag: "NYAA", color: COLOR.bright },
  subsplease: { tag: "SUB", color: "#b9a7e6" },
  "tpb-movies": { tag: "TPB", color: "#5fd0c5" },
  "tpb-tv": { tag: "TPB", color: "#5fd0c5" },
  "x1337-movies": { tag: "1337", color: "#f6a55c" },
  "x1337-tv": { tag: "1337", color: "#f6a55c" },
};

// Tolerant lookup: a source id may be absent (a pasted magnet / bare infohash) or
// no longer exist (a removed source persisted in old history/seeds). Fall back to a
// neutral tag rather than indexing SOURCE_STYLE and crashing on `undefined`.
export function sourceStyle(id?: SourceId): { tag: string; color: string } {
  const s = id ? (SOURCE_STYLE as Record<string, { tag: string; color: string }>)[id] : undefined;
  return s ?? { tag: "•", color: COLOR.alt };
}

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

export const ACCENT_RAMP: readonly [string, string] = [COLOR.accent, COLOR.bright];
