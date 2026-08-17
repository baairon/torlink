import { Box } from "ink";
import { describe, expect, it } from "vitest";
import { Poster } from "./Poster";
import { renderUI } from "../testHarness";
import { displayWidth } from "../textWidth";
import type { PosterCells } from "../../meta/image";

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
    expect(raw).toContain("[38;2;255;0;0m");
    expect(raw).toContain("[48;2;0;0;255m");
    expect(raw).toContain("[38;2;0;255;0m");
    expect(raw).toContain("[48;2;0;0;0m");
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
