import { lerpHex } from "../src/ui/theme";
import {
  SHEEN_PEAK,
  SHEEN_TICK_MS,
  sheenCenter,
  sheenIntensity,
  sheenLoopTicks,
  sheenPeriod,
} from "../src/ui/sheen";

export interface AnsiToSvgOptions {
  cols: number;
  bg?: string;
  title?: string;
  maxWidth?: number;
  /** Animate a sweeping highlight over progress-bar fills (rows with a ░ track). */
  shimmer?: boolean;
}

interface Style {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  inverse: boolean;
  fg: string | null;
  bg: string | null;
}

interface Run {
  col: number;
  text: string;
  style: Style;
}

const FONT_SIZE = 16;
const CHAR_W = 9.6;
const LINE_H = 22;
const PAD = 32;
const HEADER_H = 36;
const RADIUS = 14;
const BG = "#0a0810";
const FG_DEFAULT = "#ddd8ea";
const DIM_OPACITY = 0.55;
const FONT_STACK =
  'ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';

const PALETTE16 = [
  "#262626", "#ee7d92", "#86d6a2", "#f0c560",
  "#8fb4d8", "#c79bd8", "#7fc8c4", "#ece4da",
  "#7f7f7f", "#f59cab", "#a3e6bb", "#f7d68a",
  "#a9c8e8", "#d8b3e8", "#9adcd8", "#fff8ef",
];

function freshStyle(): Style {
  return { bold: false, dim: false, italic: false, inverse: false, fg: null, bg: null };
}

function hex(n: number): string {
  return n.toString(16).padStart(2, "0");
}

function color256(n: number): string {
  if (n < 16) return PALETTE16[n]!;
  if (n < 232) {
    const v = (x: number) => (x === 0 ? 0 : 55 + x * 40);
    const i = n - 16;
    const r = v(Math.floor(i / 36));
    const g = v(Math.floor(i / 6) % 6);
    const b = v(i % 6);
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }
  const gray = 8 + 10 * (n - 232);
  return `#${hex(gray)}${hex(gray)}${hex(gray)}`;
}

function applySgr(style: Style, params: number[]): Style {
  const s = { ...style };
  if (params.length === 0) params = [0];
  for (let i = 0; i < params.length; i++) {
    const p = params[i]!;
    if (p === 0) Object.assign(s, freshStyle());
    else if (p === 1) s.bold = true;
    else if (p === 2) s.dim = true;
    else if (p === 22) { s.bold = false; s.dim = false; }
    else if (p === 3) s.italic = true;
    else if (p === 23) s.italic = false;
    else if (p === 7) s.inverse = true;
    else if (p === 27) s.inverse = false;
    else if (p === 39) s.fg = null;
    else if (p === 49) s.bg = null;
    else if (p === 38 || p === 48) {
      const isFg = p === 38;
      const mode = params[i + 1];
      if (mode === 2) {
        const [r, g, b] = [params[i + 2] ?? 0, params[i + 3] ?? 0, params[i + 4] ?? 0];
        const c = `#${hex(r)}${hex(g)}${hex(b)}`;
        if (isFg) s.fg = c; else s.bg = c;
        i += 4;
      } else if (mode === 5) {
        const c = color256(params[i + 2] ?? 0);
        if (isFg) s.fg = c; else s.bg = c;
        i += 2;
      }
    } else if (p >= 30 && p <= 37) s.fg = PALETTE16[p - 30]!;
    else if (p >= 90 && p <= 97) s.fg = PALETTE16[p - 90 + 8]!;
    else if (p >= 40 && p <= 47) s.bg = PALETTE16[p - 40]!;
    else if (p >= 100 && p <= 107) s.bg = PALETTE16[p - 100 + 8]!;
  }
  return s;
}

function sameStyle(a: Style, b: Style): boolean {
  return (
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.inverse === b.inverse &&
    a.fg === b.fg &&
    a.bg === b.bg
  );
}

function parseLine(line: string, state: { style: Style }, cols: number): Run[] {
  const cleaned = line.replace(/\x1b\[[0-9;?]*[A-HJKSTfhilsu]/g, "");
  const parts = cleaned.split(/(\x1b\[[0-9;]*m)/);
  const runs: Run[] = [];
  let col = 0;
  for (const part of parts) {
    if (part === "") continue;
    const m = part.match(/^\x1b\[([0-9;]*)m$/);
    if (m) {
      const params = m[1] === "" ? [] : m[1]!.split(";").map(Number);
      state.style = applySgr(state.style, params);
      continue;
    }
    const text = Array.from(part);
    if (text.length === 0) continue;
    const last = runs[runs.length - 1];
    if (last && sameStyle(last.style, state.style) && last.col + Array.from(last.text).length === col) {
      last.text += part;
    } else {
      runs.push({ col, text: part, style: { ...state.style } });
    }
    col += text.length;
  }
  if (col < cols) {
    runs.push({ col, text: " ".repeat(cols - col), style: freshStyle() });
  }
  return runs;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

export function ansiToSvg(frame: string, opts: AnsiToSvgOptions): string {
  const { cols, bg = BG, title, maxWidth, shimmer = false } = opts;
  const lines = frame.replace(/\r/g, "").split("\n");
  const isBlank = (l: string): boolean =>
    l.replace(/\x1b\[[0-9;]*m/g, "").trim() === "";
  while (lines.length > 0 && isBlank(lines[0]!)) lines.shift();
  while (lines.length > 0 && isBlank(lines[lines.length - 1]!)) lines.pop();

  const width = cols * CHAR_W + PAD * 2;
  const height = HEADER_H + lines.length * LINE_H + PAD * 2;
  const cap = maxWidth ?? width;

  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width)}" height="${fmt(height)}" viewBox="0 0 ${fmt(width)} ${fmt(height)}" style="max-width: ${fmt(cap)}px; width: 100%; height: auto;" role="img">`,
  );
  out.push(`  <rect width="100%" height="100%" rx="${RADIUS}" fill="${bg}"/>`);
  out.push(
    `  <rect x="0.5" y="0.5" width="${fmt(width - 1)}" height="${fmt(height - 1)}" rx="${RADIUS}" fill="none" stroke="#2d2b31" stroke-width="1"/>`,
  );
  if (title) {
    out.push(
      `  <text x="${fmt(width / 2)}" y="${fmt(HEADER_H / 2 + 5)}" text-anchor="middle" font-family='${FONT_STACK}' font-size="13" fill="#8a8a8a">${escapeXml(title)}</text>`,
    );
  }
  out.push(
    `  <g font-family='${FONT_STACK}' font-size="${FONT_SIZE}" fill="${FG_DEFAULT}">`,
  );

  const barRuns: { row: number; col: number; n: number; fg: string }[] = [];
  const trackLen = new Map<number, number>();

  const state = { style: freshStyle() };
  lines.forEach((line, row) => {
    const runs = parseLine(line, state, cols);
    const baseline = HEADER_H + PAD + row * LINE_H + FONT_SIZE;
    for (const run of runs) {
      let { col, text } = run;
      const st = run.style;
      const cells = Array.from(text);
      const paintsBox = st.inverse || st.bg !== null;
      if (!paintsBox) {
        let start = 0;
        let end = cells.length;
        while (start < end && cells[start] === " ") start++;
        while (end > start && cells[end - 1] === " ") end--;
        if (start === end) continue;
        col += start;
        text = cells.slice(start, end).join("");
      }
      const n = Array.from(text).length;
      const x = PAD + col * CHAR_W;
      const w = n * CHAR_W;
      const fg = st.fg ?? FG_DEFAULT;
      if (shimmer) {
        if (/^█+$/.test(text)) barRuns.push({ row, col, n, fg });
        const dim = (text.match(/░/g) ?? []).length;
        if (dim > 0) trackLen.set(row, (trackLen.get(row) ?? 0) + dim);
      }
      if (/^[│┃]+$/.test(text)) {
        const barW = text[0] === "┃" ? 2.8 : 1.4;
        for (let k = 0; k < n; k++) {
          const cx = PAD + (col + k) * CHAR_W + (CHAR_W - barW) / 2;
          out.push(
            `    <rect x="${fmt(cx)}" y="${fmt(baseline - FONT_SIZE)}" width="${fmt(barW)}" height="${LINE_H}" fill="${fg}"${st.dim ? ` fill-opacity="${DIM_OPACITY}"` : ""}/>`,
          );
        }
        continue;
      }
      if (/^[█▀▄▌▐]+$/.test(text)) {
        const top = baseline - FONT_SIZE;
        const half = LINE_H / 2;
        const dim = st.dim ? ` fill-opacity="${DIM_OPACITY}"` : "";
        const bcells = Array.from(text);
        for (let k = 0; k < n; k++) {
          const ch = bcells[k]!;
          const cellLeft = PAD + (col + k) * CHAR_W;
          let rx = cellLeft;
          let ry = top;
          let rw = CHAR_W;
          let rh = LINE_H;
          if (ch === "▀") rh = half;
          else if (ch === "▄") { ry = top + half; rh = half; }
          else if (ch === "▌") rw = CHAR_W / 2;
          else if (ch === "▐") { rx = cellLeft + CHAR_W / 2; rw = CHAR_W / 2; }
          out.push(
            `    <rect x="${fmt(rx)}" y="${fmt(ry)}" width="${fmt(rw)}" height="${fmt(rh)}" fill="${fg}"${dim}/>`,
          );
        }
        continue;
      }
      const boxFill = st.inverse ? fg : st.bg;
      if (boxFill) {
        out.push(
          `    <rect x="${fmt(x)}" y="${fmt(baseline - FONT_SIZE)}" width="${fmt(w)}" height="${LINE_H}" fill="${boxFill}"${st.dim ? ` fill-opacity="${DIM_OPACITY}"` : ""}/>`,
        );
      }
      if (text.trim() === "" && !st.inverse) continue;
      const attrs: string[] = [
        `x="${fmt(x)}"`,
        `y="${fmt(baseline)}"`,
        `textLength="${fmt(w)}"`,
        `lengthAdjust="spacingAndGlyphs"`,
        `xml:space="preserve"`,
      ];
      const fill = st.inverse ? bg : fg;
      if (fill !== FG_DEFAULT) attrs.push(`fill="${fill}"`);
      if (st.dim && !st.inverse) attrs.push(`fill-opacity="${DIM_OPACITY}"`);
      if (st.bold) attrs.push(`font-weight="600"`);
      if (st.italic) attrs.push(`font-style="italic"`);
      out.push(`    <text ${attrs.join(" ")}>${escapeXml(text)}</text>`);
    }
  });

  out.push("  </g>");

  if (shimmer && barRuns.length > 0) {
    // Reproduce the live ProgressBar sheen 1:1: for each filled cell, animate
    // its fill through the exact bell-tinted colors, snapping frame-to-frame
    // (calcMode="discrete") like the terminal repaint, so it stays pixelated.
    const byRow = new Map<number, { col: number; n: number; fg: string }[]>();
    for (const r of barRuns) {
      if (!trackLen.has(r.row)) continue;
      const arr = byRow.get(r.row) ?? [];
      arr.push({ col: r.col, n: r.n, fg: r.fg });
      byRow.set(r.row, arr);
    }

    for (const [row, parts] of byRow) {
      parts.sort((a, b) => a.col - b.col);
      // Merge contiguous █ runs into one region, expanded to per-cell colors.
      const regions: { col: number; colors: string[] }[] = [];
      for (const p of parts) {
        const last = regions[regions.length - 1];
        const cells = Array.from({ length: p.n }, () => p.fg);
        if (last && last.col + last.colors.length === p.col) last.colors.push(...cells);
        else regions.push({ col: p.col, colors: cells });
      }

      const yTop = HEADER_H + PAD + row * LINE_H;
      for (const region of regions) {
        const len = region.colors.length;
        const fullCells = len + (trackLen.get(row) ?? 0);
        const period = sheenPeriod(fullCells);
        const frames = sheenLoopTicks(period);
        const dur = (frames * SHEEN_TICK_MS) / 1000;
        for (let i = 0; i < len; i++) {
          const base = region.colors[i]!;
          const values: string[] = [];
          for (let t = 0; t < frames; t++) {
            const intensity = sheenIntensity(i, sheenCenter(t, period));
            values.push(intensity > 0 ? lerpHex(base, SHEEN_PEAK, intensity) : base);
          }
          const x = PAD + (region.col + i) * CHAR_W;
          out.push(
            `  <rect x="${fmt(x)}" y="${fmt(yTop)}" width="${fmt(CHAR_W)}" height="${LINE_H}" fill="${base}">`,
          );
          out.push(
            `    <animate attributeName="fill" calcMode="discrete" dur="${fmt(dur)}s" values="${values.join(";")}" repeatCount="indefinite"/>`,
          );
          out.push(`  </rect>`);
        }
      }
    }
  }

  out.push("</svg>");
  return out.join("\n");
}
