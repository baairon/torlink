import { Box } from "ink";
import { describe, expect, it } from "vitest";
import { Poster } from "./Poster";
import { renderUI } from "../testHarness";
import { displayWidth } from "../textWidth";
import { PLACEHOLDER, diacritic, idColor, placeholderLines } from "../../meta/kittyGraphics";
import type { GraphicsCells, PosterCells } from "../../meta/image";

// The invariant this file exists for: a poster line must measure exactly `cols` columns by the
// same accounting the panes use to decide what fits. U+2580 is in Block Elements, which
// textWidth.ts classifies as width 1 — if that ever drifted to 2, Yoga would clip every poster row
// and the corruption would land in the results list beside the pane, not in the poster.

function cells(cols: number, rows: number, fg = "#ff0000", bg = "#0000ff"): PosterCells {
  return {
    cols,
    rows,
    lines: Array.from({ length: rows }, () => [{ fg, bg, n: cols }]),
  };
}

/** Frame lines with the harness's trailing blanks dropped. */
function lines(frame: string): string[] {
  return frame.split("\n").filter((l) => l.trim() !== "");
}

// Placeholder art is measured by *grapheme*, not by textWidth.ts's column accounting, and the two
// disagree on purpose — see the pinning test at the bottom of this file. Every assertion about the
// width of a graphics row therefore counts clusters with the same segmenter Ink itself uses.
const segmenter = new Intl.Segmenter();
function cellCount(text: string): number {
  return [...segmenter.segment(text)].length;
}

const IMAGE_ID = 0x2a3b4c;

function image(cols: number, rows: number): GraphicsCells {
  return {
    cols,
    rows,
    lines: placeholderLines(IMAGE_ID, cols, rows) ?? [],
    color: idColor(IMAGE_ID),
    imageId: IMAGE_ID,
  };
}

describe("Poster", () => {
  it("draws one row per cell line, each exactly `cols` columns wide", () => {
    const ui = renderUI(<Poster cells={cells(6, 3)} />);
    const out = lines(ui.frame());
    expect(out).toHaveLength(3);
    for (const line of out) {
      expect(line).toBe("▀".repeat(6));
      expect(displayWidth(line)).toBe(6);
    }
    ui.unmount();
  });

  it("emits one styled span per run and keeps the row's total width", () => {
    const ui = renderUI(
      <Poster
        cells={{
          cols: 5,
          rows: 1,
          lines: [
            [
              { fg: "#ff0000", bg: "#0000ff", n: 2 },
              { fg: "#00ff00", bg: "#000000", n: 3 },
            ],
          ],
        }}
      />,
    );
    expect(lines(ui.frame())).toEqual(["▀".repeat(5)]);
    // Ink routes color/backgroundColor through chalk, so a truecolour terminal gets 38;2 and 48;2
    // pairs. Asserting on them is what proves the background half of the cell is actually painted:
    // without it a poster renders as a monochrome silhouette and still passes a width check.
    const raw = ui.rawFrame();
    expect(raw).toContain("\u001b[38;2;255;0;0m");
    expect(raw).toContain("\u001b[48;2;0;0;255m");
    expect(raw).toContain("\u001b[38;2;0;255;0m");
    expect(raw).toContain("\u001b[48;2;0;0;0m");
    ui.unmount();
  });

  it("keeps its rows intact inside a box exactly its own width", () => {
    // A pane is a fixed-width box with overflow hidden. Yoga answers an overflowing child by
    // squeezing rows — lines get dropped and fused rather than truncated — so the assertion that
    // matters is that all of them are still there at their full width.
    const ui = renderUI(
      <Box width={24} height={12} overflow="hidden" flexDirection="column">
        <Poster cells={cells(24, 12)} />
      </Box>,
    );
    const out = lines(ui.frame());
    expect(out).toHaveLength(12);
    for (const line of out) expect(displayWidth(line)).toBe(24);
    ui.unmount();
  });

  it("renders nothing at all for an empty grid", () => {
    const ui = renderUI(<Poster cells={{ cols: 0, rows: 0, lines: [] }} />);
    expect(lines(ui.frame())).toEqual([]);
    ui.unmount();
  });
});

describe("Poster, graphics art", () => {
  it("draws one row per cell line, each exactly `cols` cells wide", () => {
    const ui = renderUI(<Poster cells={image(6, 3)} />);
    const out = lines(ui.frame());
    expect(out).toHaveLength(3);
    for (const [row, line] of out.entries()) {
      expect(cellCount(line)).toBe(6);
      // Every cell names its own row and column, so a row of art is readable straight off the
      // frame: this is row `row`, columns 0 to 5.
      expect(line).toBe(
        Array.from({ length: 6 }, (_, col) => PLACEHOLDER + diacritic(row) + diacritic(col)).join(""),
      );
    }
    ui.unmount();
  });

  it("carries the image id as one truecolour foreground for the whole row", () => {
    const ui = renderUI(<Poster cells={image(6, 2)} />);
    // 0x2a3b4c, which is what the terminal reads back as the image the placeholders address. The
    // half-block branch emits up to `cols` colour pairs a row; this branch emits one.
    expect(ui.rawFrame()).toContain("\u001b[38;2;42;59;76m");
    ui.unmount();
  });

  it("keeps its rows intact inside a box exactly its own width", () => {
    // The property that makes placeholders viable at all: Ink measures a placeholder and its marks
    // as one cell, so a row of them fits a box of `cols` and Yoga has no overflow to answer with.
    const ui = renderUI(
      <Box width={24} height={12} overflow="hidden" flexDirection="column">
        <Poster cells={image(24, 12)} />
      </Box>,
    );
    const out = lines(ui.frame());
    expect(out).toHaveLength(12);
    for (const line of out) expect(cellCount(line)).toBe(24);
    ui.unmount();
  });

  it("is measured by grapheme, and must never be measured by textWidth", () => {
    // Pinned, because the divergence is deliberate and load-bearing. displayWidth counts combining
    // marks as a column each, so it calls this one cell three columns wide. That is *correct* for
    // what textWidth.ts is for — wrapping and ellipsizing prose, where a stray mark is a stray
    // mark — and teaching it about placeholders would mean adding ranges to a table that took
    // three rounds to stop misclassifying this app's own box-drawing glyphs. Poster.tsx renders
    // art as runs and never routes it through wordWrapLines or ellipsizeToWidth, so nothing in the
    // app ever asks textWidth.ts this question. Only tests do, and they use the segmenter above.
    const cell = `${PLACEHOLDER}${diacritic(0)}${diacritic(3)}`;
    expect(cellCount(cell)).toBe(1);
    expect(displayWidth(cell)).toBe(3);
  });
});
