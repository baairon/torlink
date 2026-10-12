// Terminal column accounting, shared by every view that has to know how much of a fixed-size
// panel a string will actually occupy *before* Ink lays it out.
//
// This lives in its own module rather than inside the component that first needed it because two
// views now depend on the same answers — the detail panel and the info pane beside the results
// list — and a second copy of this table is a second thing to get wrong. Ink/Yoga clips an
// overflowing panel by squeezing rows, not by cutting the offending line, so a miscount here shows
// up as dropped and fused rows somewhere else entirely.

// DetailRow's fixed label column width. Hoisted so Detail's own layout-budget math (which needs
// to know exactly how many columns are left for a value) can never independently drift from what
// DetailRow actually renders — two copies of this number is exactly the kind of silent mismatch
// that reintroduces the panel-overflow bug behind an otherwise green test suite.
export const LABEL_W = 9;

// [start, end] (inclusive) code point ranges rendered at 2 terminal columns: East Asian
// Wide/Fullwidth blocks, plus the specific BMP and astral emoji/symbol ranges terminals render
// double-width.
//
// This has to cover the full 0–0x10FFFF space, astral planes included. There is no free ride for
// an emoji or a CJK Extension B+ ideograph the way there was for `.length`, which counted 2
// UTF-16 units per astral code point regardless of what the character actually was — `for...of`
// (below, and throughout this file) yields one code point per surrogate pair, so an astral
// character gets exactly the same "look it up or default to 1" treatment as a BMP one. A prior
// version of this table left every astral range out entirely on the theory that `.length` already
// handled them; that was the same 2x undercount as the bug this whole mechanism exists to
// prevent, just relocated to emoji and rare CJK ideographs instead of common ones.
//
// Solid CJK/Hangul/fullwidth territory is merged into single generous spans — a handful of narrow
// or unassigned code points inside one of those costs at most one wasted row. U+2000–U+2BFF is
// the one region kept surgical rather than swept: it also holds Box Drawing (this app's own
// panel borders — ─│╭╮╰╯ all live at U+2500+) and Geometric Shapes, both mostly narrow, so a wide
// net here would double-count the UI's own chrome, not just waste a line.
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x231a, 0x231b], // watch, hourglass
  [0x2329, 0x232a], // angle brackets
  [0x23e9, 0x23ec], // fast-forward/rewind/next/last track
  [0x23f0, 0x23f0], // alarm clock
  [0x23f3, 0x23f3], // hourglass (flowing)
  [0x25fd, 0x25fe], // small squares
  [0x2614, 0x2615], // umbrella, hot beverage
  [0x2648, 0x2653], // zodiac signs
  [0x267f, 0x267f], // wheelchair symbol
  [0x2693, 0x2693], // anchor
  [0x26a1, 0x26a1], // high voltage
  [0x26aa, 0x26ab], // circles
  [0x26bd, 0x26be], // soccer ball, baseball
  [0x26c4, 0x26c5], // snowman, sun behind cloud
  [0x26ce, 0x26ce], // ophiuchus
  [0x26d4, 0x26d4], // no entry
  [0x26ea, 0x26ea], // church
  [0x26f2, 0x26f3], // fountain, flag in hole
  [0x26f5, 0x26f5], // sailboat
  [0x26fa, 0x26fa], // tent
  [0x26fd, 0x26fd], // fuel pump
  [0x2705, 0x2705], // check mark button
  [0x270a, 0x270b], // raised fist, raised hand
  [0x2728, 0x2728], // sparkles
  [0x274c, 0x274c], // cross mark
  [0x274e, 0x274e], // negative squared cross mark
  [0x2753, 0x2755], // question/exclamation marks
  [0x2757, 0x2757], // heavy exclamation mark
  [0x2795, 0x2797], // plus/minus/division
  [0x27b0, 0x27b0], // curly loop
  [0x27bf, 0x27bf], // double curly loop
  [0x2b1b, 0x2b1c], // large squares
  [0x2b50, 0x2b50], // star
  [0x2b55, 0x2b55], // heavy large circle
  [0x2e80, 0x9fff], // CJK radicals through CJK unified ideographs — Hiragana, Katakana, Hangul
  // compatibility Jamo, Yijing hexagrams and everything else in this span included
  [0xa000, 0xa4cf], // Yi syllables and radicals
  [0xa960, 0xa97f], // Hangul Jamo Extended-A
  [0xac00, 0xd7a3], // Hangul syllables
  [0xd7b0, 0xd7ff], // Hangul Jamo Extended-B
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe10, 0xfe19], // vertical forms
  [0xfe30, 0xfe6b], // CJK compatibility forms, small form variants
  [0xff00, 0xff60], // fullwidth forms (halfwidth katakana/Hangul at 0xff61+ excluded on purpose)
  [0xffe0, 0xffe6], // fullwidth signs
  [0x1f000, 0x1ffff], // mahjong/domino/cards, enclosed CJK, emoji, transport, chess, pictographs
  [0x20000, 0x3fffd], // CJK unified ideographs extension B and every plane beyond it
];

function isWideCodePoint(cp: number): boolean {
  for (const [start, end] of WIDE_RANGES) {
    if (cp >= start && cp <= end) return true;
  }
  return false;
}

// A `for...of` over a string yields whole code points (surrogate pairs included), so this reads
// one on-screen glyph at a time rather than one UTF-16 unit — the distinction that matters for a
// CJK character (one unit, two columns) exactly as much as for an astral one (an emoji, a rare
// CJK ideograph): both are a single code point handed to `isWideCodePoint`, no special-casing
// either way. Exported so a test can measure a rendered frame by the identical column accounting
// the components use to decide what fits, rather than trusting a second, potentially-diverging
// implementation to agree with it.
export function codePointWidth(ch: string): number {
  const cp = ch.codePointAt(0);
  return cp !== undefined && isWideCodePoint(cp) ? 2 : 1;
}

export function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += codePointWidth(ch);
  return w;
}

// Breaks a single run of text with no whitespace into chunks that each fit within `width` display
// columns, splitting only between code points, never inside one.
function breakToWidth(text: string, width: number): string[] {
  const chunks: string[] = [];
  let chunk = "";
  let col = 0;
  for (const ch of text) {
    const w = codePointWidth(ch);
    if (col + w > width && chunk !== "") {
      chunks.push(chunk);
      chunk = "";
      col = 0;
    }
    chunk += ch;
    col += w;
  }
  if (chunk !== "") chunks.push(chunk);
  return chunks;
}

// Trims to at most `width` display columns before the ellipsis, using the same column accounting
// as wordWrapLines below. A plain `.slice()` counts UTF-16 units, which can land inside a CJK
// character (one unit, two columns) or split a surrogate-pair emoji in half; this never does.
// Every call site clamps its width with `Math.max(1, …)` before calling in, so there is no
// `width <= 0` case to guard here, same reasoning as wordWrapLines below.
export function ellipsizeToWidth(text: string, width: number): string {
  if (width === 1) return "…";
  let out = "";
  let col = 0;
  for (const ch of text) {
    const w = codePointWidth(ch);
    if (col + w > width - 1) break;
    out += ch;
    col += w;
  }
  return `${out}…`;
}

// Greedy word wrap, used only to learn — and pin — exactly how many terminal rows a value will
// occupy before Ink ever lays it out. Both panels that use it have a fixed height (Panel's
// `height` prop, clipped with `overflow: hidden`), and handing Ink's own `wrap="wrap"` more text
// than that budget allows does not clip cleanly: Yoga's flexbox shrink squeezes whichever rows
// land on the losing side of its shrink math, dropping or fusing rows anywhere in the block,
// including ones above the actual overflow. Every metadata row is only rendered once it is known
// to fit, which means knowing its line count first.
//
// Wraps by *display* column, not UTF-16 code unit: a CJK character is one JS string unit but two
// terminal columns, and Nyaa (an anime index, one of torlink's own sources) plus Cinemeta's
// Japanese/Korean/Chinese titles make CJK cast and plot text a routine path here, not an edge
// case. A word wider than `width` (a Cinemeta plot has no guaranteed word-length cap, and neither
// does a single-token cast credit) is hard-broken into `width`-wide chunks rather than left to
// overflow its own line — Ink's real wrap does the same, and undercounting here is exactly what
// let a single unbroken run of text blow through a budget that looked, on paper, like it had room
// to spare.
export function wordWrapLines(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = "";
  let lineWidth = 0;
  for (const word of words) {
    const wordWidth = displayWidth(word);
    if (wordWidth > width) {
      if (line !== "") {
        lines.push(line);
        line = "";
        lineWidth = 0;
      }
      const chunks = breakToWidth(word, width);
      const last = chunks.pop() ?? "";
      for (const chunk of chunks) lines.push(chunk);
      line = last;
      lineWidth = displayWidth(last);
      continue;
    }
    if (line === "") {
      line = word;
      lineWidth = wordWidth;
    } else if (lineWidth + 1 + wordWidth <= width) {
      line += ` ${word}`;
      lineWidth += 1 + wordWidth;
    } else {
      lines.push(line);
      line = word;
      lineWidth = wordWidth;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}
