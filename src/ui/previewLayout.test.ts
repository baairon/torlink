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

describe("preview layout, focused", () => {
  it("gives the pane every column the list can spare, up to what it can use", () => {
    // The reverse of the unfocused rule: the user has said the pane is what they are reading, so
    // the list falls back to the narrowest width it is allowed to have and the pane takes the rest.
    for (const w of [100, 110, 113]) {
      const pl = previewLayout(w, true);
      expect(pl, `contentWidth ${w}`).not.toBeNull();
      if (pl === null) continue;
      expect(pl.list, `list at ${w}`).toBe(MIN_LIST_WIDTH);
      expect(pl.pane, `pane at ${w}`).toBe(w - PANE_GAP - MIN_LIST_WIDTH);
    }
  });

  it("stops widening the pane once it has more columns than it can spend", () => {
    // The art is capped at 24 columns however wide the pane is, so past a comfortable measure the
    // extra columns are blank space beside the poster — and the list, whose name column truncates
    // at MIN_LIST_WIDTH, has an obvious use for every one of them.
    expect(previewLayout(160, true)).toEqual({ pane: 60, list: 99, poster: true });
    expect(previewLayout(200, true)).toEqual({ pane: 60, list: 139, poster: true });
    // 113 is the last width where the list can still be the one at its minimum; one column later
    // the pane is at the cap and the list starts growing again.
    expect(previewLayout(113, true)?.pane).toBe(60);
    expect(previewLayout(114, true)).toEqual({ pane: 60, list: 53, poster: true });
  });

  it("holds the unfocused widths where there is nothing to give", () => {
    // 73 is the one width at which the list is already at MIN_LIST_WIDTH, so focusing there is a
    // no-op rather than a pane that grows by starving the list.
    expect(previewLayout(73, true)).toEqual(previewLayout(73, false));
    // Everywhere else the list is holding columns above its minimum, and focus is what hands them
    // over: 86 has 5 to give, and one column above a tier boundary the pane takes that one too.
    expect(previewLayout(86, true)?.pane).toBe(33);
    expect(previewLayout(101, true)?.pane).toBe(48);
    expect(previewLayout(101, false)?.pane).toBe(34);
  });

  it("never shrinks the pane or the list below what browsing already guaranteed", () => {
    for (let w = 73; w <= 300; w += 1) {
      const idle = previewLayout(w);
      const read = previewLayout(w, true);
      expect(read, `contentWidth ${w}`).not.toBeNull();
      if (idle === null || read === null) continue;
      expect(read.pane, `pane at ${w}`).toBeGreaterThanOrEqual(idle.pane);
      expect(read.list, `list at ${w}`).toBeGreaterThanOrEqual(MIN_LIST_WIDTH);
      // The same arithmetic the unfocused split is pinned on: a column lost between the two
      // panels is a fused row, not an error.
      expect(read.list + PANE_GAP + read.pane).toBe(w);
      expect(read.poster).toBe(idle.poster);
    }
  });

  it("cannot conjure a pane at a width that has none", () => {
    // Focus is not a way in: previewLayout answering null is what makes → a no-op at 80 columns.
    for (const w of [72, 40, 0]) expect(previewLayout(w, true)).toBeNull();
    expect(previewLayout(TEST_CONTENT_WIDTH, true)).toBeNull();
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

  it("sizes focused art from the width alone, at heights that would have vetoed it", () => {
    // The measurement that motivated the whole mode: at a 26-row terminal the pane has 13 inner
    // rows and the art was 8x6. Focused it asks for the full width and lets the poster's own
    // aspect answer for the height — fitCells is width-first, so a 2:3 poster lands at 24x18.
    expect(posterBudget(34, 13, true)).toEqual({ cols: 24, rows: 48 });
    expect(posterBudget(48, 13, true)).toEqual({ cols: 24, rows: 48 });
    // Where the unfocused pane had already given up on art entirely, focus brings it back.
    expect(posterBudget(34, 12)).toBeNull();
    expect(posterBudget(34, 12, true)).toEqual({ cols: 24, rows: 48 });
  });

  it("still refuses art a focused pane has no room to read around", () => {
    // A pane showing fewer rows than MIN_POSTER_ROWS would open on a wall of art with the facts
    // several keypresses below it, which is hunting rather than reading.
    expect(posterBudget(34, 5, true)).toBeNull();
    expect(posterBudget(34, 6, true)).toEqual({ cols: 24, rows: 48 });
    expect(posterBudget(4, 40, true)).toBeNull();
  });
});
