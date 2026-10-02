import { describe, expect, it } from "vitest";
import { codePointWidth, displayWidth, ellipsizeToWidth, wordWrapLines } from "./textWidth";

// Astral code points (emoji outside the BMP, CJK Extension B+ ideographs) get no free ride from
// `.length` the way a BMP character never did either — `for...of` yields one code point per
// surrogate pair, so an unlisted astral range undercounts exactly like an unlisted BMP one. A
// prior version of this file's width table left every astral range out on the theory that
// `.length` already "handled" them, which reproduced the original Critical bug on emoji plots.
describe("terminal column width", () => {
  it("measures the full reviewer-named spread of wide and narrow code points correctly", () => {
    // Wide: astral emoji/pictographs, BMP dingbat emoji scattered through U+231A..U+2B55, a rare
    // astral CJK ideograph (Extension B), a Vertical Forms code point, plus one representative
    // each of Hangul Jamo, CJK unified ideographs and Hangul syllables.
    const wide = [
      0x1f3ac, // 🎬 clapper board (astral emoji)
      0x2b50, // ⭐ star (BMP emoji)
      0x2705, // ✅ check mark button
      0x2757, // ❗ heavy exclamation mark
      0x2b1b, // ⬛ black large square
      0x231a, // ⌚ watch
      0x20000, // 𠀀 CJK unified ideographs extension B
      0xfe10, // ︐ presentation form for vertical comma
      0x4e00, // 一 CJK unified ideographs
      0xac00, // 가 Hangul syllable
    ];
    // Narrow: this app's own border/pointer characters (the regression a too-broad wide range
    // caused in an earlier draft of this table), halfwidth katakana, and a spread of non-CJK
    // scripts that must never be measured as wide.
    const narrow = [
      0x2500, // ─ box drawings light horizontal (this app's own panel border)
      0x2502, // │ box drawings light vertical
      0x276f, // ❯ heavy right-pointing angle quotation mark ornament (list cursor)
      0x61, // a
      0xff71, // ｱ halfwidth katakana A
      0xff61, // ｡ halfwidth ideographic full stop
      0x439, // й Cyrillic
      0x3b1, // α Greek
      0xe9, // é Latin-1
      0x5d0, // א Hebrew
      0x627, // ا Arabic
      0xe01, // ก Thai
    ];
    for (const cp of wide) {
      expect(codePointWidth(String.fromCodePoint(cp)), `U+${cp.toString(16)} should be wide`).toBe(2);
    }
    for (const cp of narrow) {
      expect(codePointWidth(String.fromCodePoint(cp)), `U+${cp.toString(16)} should be narrow`).toBe(1);
    }
  });
});

// The info pane wraps into 16 columns on its narrowest tier — less than half the width the detail
// panel ever asked of these helpers — so the properties below are pinned directly rather than
// only through a rendered frame.
describe("wrapping to a narrow column budget", () => {
  const fits = (lines: string[], width: number): void => {
    for (const l of lines) expect(displayWidth(l), `"${l}"`).toBeLessThanOrEqual(width);
  };

  it("never emits a line wider than the budget, whatever the script", () => {
    const cases = [
      "The Shawshank Redemption",
      "Cast Tim Robbins, Morgan Freeman, Bob Gunton, William Sadler",
      "本作は刑務所を舞台にした友情と希望の物語である",
      "🎬🎬🎬🎬🎬🎬🎬🎬🎬🎬🎬🎬",
      "Antidisestablishmentarianism",
    ];
    for (const width of [16, 24, 30]) {
      for (const text of cases) fits(wordWrapLines(text, width), width);
    }
  });

  it("keeps every word, in order, when it hard-breaks an oversized one", () => {
    const lines = wordWrapLines("Dir Wolfeschlegelsteinhausenbergerdorff", 16);
    fits(lines, 16);
    expect(lines.join("").replace(/\s/g, "")).toBe("DirWolfeschlegelsteinhausenbergerdorff");
  });

  it("counts a wide code point as two columns wherever it lands", () => {
    expect(displayWidth("田中誠")).toBe(6);
    expect(displayWidth("Dir 田中誠")).toBe(10);
    expect(displayWidth("")).toBe(0);
  });

  it("ellipsizes on a code point boundary, never inside one", () => {
    expect(ellipsizeToWidth("Redemption", 6)).toBe("Redem…");
    expect(ellipsizeToWidth("Redemption", 1)).toBe("…");
    // A wide character cannot half-fit: it is dropped rather than counted as one column.
    expect(displayWidth(ellipsizeToWidth("田中誠一郎", 6))).toBeLessThanOrEqual(6);
    expect(ellipsizeToWidth("🎬🎬🎬", 5)).toBe("🎬🎬…");
  });
});
