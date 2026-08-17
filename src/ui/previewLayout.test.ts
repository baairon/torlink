import { describe, expect, it } from "vitest";
import { MIN_LIST_WIDTH, PANE_GAP, posterBudget, previewLayout } from "./previewLayout";
import { TEST_CONTENT_WIDTH } from "./testHarness";

describe("preview layout tiers", () => {
  it("hands out the documented pane and list widths at each tier boundary", () => {
    expect(previewLayout(100)).toEqual({ pane: 34, list: 65, poster: true });
    expect(previewLayout(86)).toEqual({ pane: 28, list: 57, poster: true });
    expect(previewLayout(73)).toEqual({ pane: 20, list: 52, poster: false });
  });

  it("steps down one tier at a time, one column below each boundary", () => {
    expect(previewLayout(99)?.pane).toBe(28);
    expect(previewLayout(85)?.pane).toBe(20);
    expect(previewLayout(72)).toBeNull();
  });

  it("drops the poster only on the narrowest tier", () => {
    expect(previewLayout(99)?.poster).toBe(true);
    expect(previewLayout(85)?.poster).toBe(false);
  });

  it("gives every extra column to the list, never to the pane", () => {
    // The pane is pinned per tier so its card never rewraps on resize; the list absorbs the rest
    // through the name column's flexGrow, exactly as it already does without a pane.
    const wide = previewLayout(160);
    expect(wide?.pane).toBe(34);
    expect(wide?.list).toBe(160 - 34 - PANE_GAP);
  });

  it("never starves the list below MIN_LIST_WIDTH, at any width the pane exists", () => {
    for (let w = 73; w <= 300; w += 1) {
      const pl = previewLayout(w);
      expect(pl, `contentWidth ${w} should have a layout`).not.toBeNull();
      if (pl === null) continue;
      expect(pl.list, `list at contentWidth ${w}`).toBeGreaterThanOrEqual(MIN_LIST_WIDTH);
      // The three widths have to add up: a rounding slip here is a pane that overlaps the list's
      // right border, which Ink renders as a fused row rather than an error.
      expect(pl.list + PANE_GAP + pl.pane).toBe(w);
    }
  });

  it("hides itself entirely below the narrowest tier", () => {
    for (const w of [72, 61, 40, 24, 0, -5]) expect(previewLayout(w)).toBeNull();
  });

  // The 80-column terminal the whole test suite renders at. The pane must not exist there, or
  // every existing frame assertion in Results.test.tsx is measuring a different layout.
  it("is absent at the harness's own 80-column content width", () => {
    expect(previewLayout(TEST_CONTENT_WIDTH)).toBeNull();
  });
});

describe("poster budget", () => {
  it("reserves the text card's rows and caps the art's width", () => {
    // 34-wide pane: 30 columns inside Panel's frame, capped to 24. 20 inner rows less the 7 the
    // text card always claims leaves 13.
    expect(posterBudget(34, 20)).toEqual({ cols: 24, rows: 13 });
    // 28-wide pane: 24 inside the frame, exactly at the cap.
    expect(posterBudget(28, 20)).toEqual({ cols: 24, rows: 13 });
  });

  it("drops the art rather than the facts on a short pane", () => {
    // 13 inner rows: 6 left after the text card, the last height that still earns a poster.
    expect(posterBudget(34, 13)).toEqual({ cols: 24, rows: 6 });
    expect(posterBudget(34, 12)).toBeNull();
    expect(posterBudget(34, 7)).toBeNull();
    expect(posterBudget(34, 0)).toBeNull();
  });

  it("answers null rather than a negative cell budget for a pane with no room inside its frame", () => {
    expect(posterBudget(4, 40)).toBeNull();
    expect(posterBudget(0, 40)).toBeNull();
  });
});
