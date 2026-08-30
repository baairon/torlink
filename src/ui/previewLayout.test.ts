import { describe, expect, it } from "vitest";
import {
  COLUMN_GAP,
  MAX_TEXT_COLS,
  MIN_LIST_WIDTH,
  MIN_TEXT_COLS,
  PANE_GAP,
  posterBudget,
  previewLayout,
  splitTextCols,
} from "./previewLayout";
import { fitCells } from "../meta/image";
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
    // With no height given there is no poster to seat a card beside, so the pane is only ever a
    // card and MAX_TEXT_COLS + Panel's frame is the whole of it: a text measure past the
    // mid-fifties stops helping, because the eye loses the line it is returning to. The list,
    // whose name column truncates at MIN_LIST_WIDTH, has an obvious use for every column past
    // that. (Handed a height, the pane can spend more — see "focused pane width, by height".)
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
  it("reserves the text card's rows and spends every column the pane has on the art", () => {
    // 34-wide pane: 30 columns inside Panel's frame. 20 inner rows less the 7 the text card
    // always claims leaves 13.
    expect(posterBudget(34, 20)).toEqual({ cols: 30, rows: 13 });
    // 28-wide pane: 24 inside the frame, and the same rows — width is the tier's answer, height
    // is the pane's.
    expect(posterBudget(28, 20)).toEqual({ cols: 24, rows: 13 });
  });

  it("drops the art rather than the facts on a short pane", () => {
    // 13 inner rows: 6 left after the text card, the last height that still earns a poster.
    expect(posterBudget(34, 13)).toEqual({ cols: 30, rows: 6 });
    expect(posterBudget(34, 12)).toBeNull();
    expect(posterBudget(34, 7)).toBeNull();
    expect(posterBudget(34, 0)).toBeNull();
  });

  it("answers null rather than a negative cell budget for a pane with no room inside its frame", () => {
    expect(posterBudget(4, 40)).toBeNull();
    expect(posterBudget(0, 40)).toBeNull();
  });

  it("makes a focused poster give up columns, not rows, once the card can sit beside it", () => {
    // 48-wide pane: 44 inside the frame, and the art hands back exactly COLUMN_GAP + MIN_TEXT_COLS
    // of that so the card has a column of its own. What it keeps is the pane's entire height —
    // capping the art by height instead is what let a tall terminal grow the poster until nothing
    // could fit next to it, which is how a 120-column terminal ended up stacked with one row of
    // text.
    expect(posterBudget(48, 13, true)).toEqual({ cols: 15, rows: 13 });
    expect(posterBudget(48, 17, true)).toEqual({ cols: 15, rows: 17 });
    // A wider pane spends the difference on the picture, not on a wider card: MAX_TEXT_COLS is
    // what previewLayout stopped widening the pane at, so the card is already at its measure.
    expect(posterBudget(60, 17, true)).toEqual({ cols: 27, rows: 17 });
    expect(posterBudget(84, 17, true)).toEqual({ cols: 51, rows: 17 });
  });

  it("falls back to giving up rows where nothing can sit beside the art", () => {
    // 34-wide pane: 30 inside the frame, which leaves 1 column beside a card at MIN_TEXT_COLS —
    // not a picture. So the card takes its rows from the bottom instead, and what it takes is
    // FOCUSED_TEXT_RESERVE: the eight rows it is guaranteed plus the spacer and the scroll
    // affordance, neither of which is card.
    expect(posterBudget(34, 20, true)).toEqual({ cols: 30, rows: 10 });
    expect(posterBudget(34, 17, true)).toEqual({ cols: 30, rows: 7 });
    // One column either side of the boundary: 41 seats an 8-column poster beside the card (the
    // narrowest picture MIN_POSTER_COLS allows), 40 cannot and stacks.
    expect(posterBudget(41, 17, true)).toEqual({ cols: 8, rows: 17 });
    expect(posterBudget(40, 17, true)).toEqual({ cols: 36, rows: 7 });
  });

  it("still refuses art a focused pane has no room to read around", () => {
    // Stacked, the floor is MIN_POSTER_ROWS on top of the whole reserve: 16 inner rows, six of
    // picture with the ten the card and its chrome are guaranteed. Below it the pane drops the art
    // and spends every row on the card, which is the trade the guarantee exists to make.
    expect(posterBudget(34, 16, true)).toEqual({ cols: 30, rows: 6 });
    expect(posterBudget(34, 15, true)).toBeNull();
    expect(posterBudget(34, 8, true)).toBeNull();
    // Beside the card the floor is MIN_POSTER_ROWS alone, since the art is giving up columns
    // rather than rows: a six-row pane still seats a six-row picture next to a full-height card.
    expect(posterBudget(48, 6, true)).toEqual({ cols: 15, rows: 6 });
    expect(posterBudget(48, 5, true)).toBeNull();
    expect(posterBudget(4, 40, true)).toBeNull();
  });
});

// Change 1 of the review: the pane's width is bounded by the card's *measure*, not by the pane.
// Stacked those are the same number and nothing moves; side by side the pane must also carry a
// poster, and how wide that poster comes out is a question about the pane's height.
describe("focused pane width, by height", () => {
  it("grows the pane to seat the card beside the poster, and not one column further", () => {
    // A 30-row terminal leaves the pane 17 inner rows, where a 2:3 poster is 23 columns wide.
    // 23 + COLUMN_GAP + MAX_TEXT_COLS + Panel's frame is 84, and the list keeps everything past it.
    expect(previewLayout(141, true, 17)).toEqual({ pane: 84, list: 56, poster: true });
    expect(previewLayout(181, true, 17)).toEqual({ pane: 84, list: 96, poster: true });
    // A shorter pane wants a narrower poster and therefore a narrower pane.
    expect(previewLayout(141, true, 11)).toEqual({ pane: 76, list: 64, poster: true });
    // And without a height there is no poster to seat anything beside, so the pane is a card and
    // stops at MAX_TEXT_COLS inside its frame — the width every caller got before.
    expect(previewLayout(141, true)).toEqual({ pane: 60, list: 80, poster: true });
  });

  it("keeps the list at its minimum rather than granting a width it cannot afford", () => {
    // 120 terminal columns is contentWidth 101, and the list needs 52 of them: the pane genuinely
    // cannot exceed 48 whatever it would like. The terminal is the constraint there, not the cap.
    expect(previewLayout(101, true, 17)).toEqual({ pane: 48, list: 52, poster: true });
    for (let w = 73; w <= 300; w += 1) {
      for (const rows of [0, 6, 11, 17, 27]) {
        const pl = previewLayout(w, true, rows);
        expect(pl, `contentWidth ${w}`).not.toBeNull();
        if (pl === null) continue;
        expect(pl.list, `list at ${w}/${rows}`).toBeGreaterThanOrEqual(MIN_LIST_WIDTH);
        expect(pl.list + PANE_GAP + pl.pane, `sum at ${w}/${rows}`).toBe(w);
        const idle = previewLayout(w);
        expect(pl.pane, `pane at ${w}/${rows}`).toBeGreaterThanOrEqual(idle?.pane ?? 0);
      }
    }
  });

  it("refuses the wider grant where the extra columns would not become card", () => {
    // contentWidth 94 leaves 41 for the pane — 37 inside the frame, exactly MIN_POSTER_COLS plus
    // the gap plus MIN_TEXT_COLS — so the grant buys a real split. One column less and it would
    // only buy a wider stacked pane with dead columns beside a card already at its measure, so
    // the list keeps it. This is the off-by-one at the bottom of the split.
    expect(previewLayout(94, true, 17)?.pane).toBe(41);
    expect(previewLayout(93, true, 17)?.pane).toBe(40);
    expect(splitTextCols(41 - 4, 8)).toBe(MIN_TEXT_COLS);
    expect(splitTextCols(40 - 4, 8)).toBeNull();
  });
});

// The focused pane's own split: poster on the left, card on the right, with the arithmetic kept
// here rather than in the component so the boundary can be pinned without a render.
describe("side-by-side split", () => {
  it("gives the card every column the art and the gap did not take", () => {
    expect(splitTextCols(56, 20)).toBe(56 - 20 - COLUMN_GAP);
    expect(splitTextCols(49, 20)).toBe(MIN_TEXT_COLS);
  });

  it("falls back to stacking one column below the readable measure", () => {
    // The off-by-one that would live exactly here: 49 inner columns beside a 20-column poster
    // leaves the card its floor and splits; 48 leaves it one short and must stack instead of
    // shaving a column off the plot.
    expect(splitTextCols(49, 20)).toBe(MIN_TEXT_COLS);
    expect(splitTextCols(48, 20)).toBeNull();
    // Same boundary walked from the art's side rather than the pane's.
    expect(splitTextCols(49, 21)).toBeNull();
  });

  it("has nothing to sit beside when no art rendered", () => {
    // A poster still in flight, refused by the host sniff or rejected by the decoder: the card
    // keeps the whole pane, which is the layout it has always had without art.
    expect(splitTextCols(56, 0)).toBeNull();
    expect(splitTextCols(56, -1)).toBeNull();
  });

  it("never splits a pane so narrow the card would be shorter than the gap", () => {
    // The narrowest tier's 16 inner columns, and the widest browsing tier's 30: both stack, which
    // is why the split is a focused-only answer.
    expect(splitTextCols(16, 12)).toBeNull();
    expect(splitTextCols(30, 20)).toBeNull();
  });

  it("always leaves the card its measure once the budget seated it beside the art", () => {
    // The budget's whole job is to make this unconditional: whatever fitCells does with the box —
    // narrow it for aspect, shrink it for a small rendition — the art can only ever come back at
    // or under the width it was handed, so what is left is at or above MIN_TEXT_COLS. The split
    // decision downstream cannot be surprised.
    for (const pane of [41, 48, 53, 60, 76, 84]) {
      for (const rows of [6, 11, 13, 17, 27]) {
        const budget = posterBudget(pane, rows, true);
        expect(budget, `${pane}x${rows}`).not.toBeNull();
        if (budget === null) continue;
        const fit = fitCells(120, 180, budget.cols, budget.rows);
        expect(splitTextCols(pane - 4, fit.cols), `${pane}x${rows}`).toBeGreaterThanOrEqual(
          MIN_TEXT_COLS,
        );
      }
    }
  });

  it("reclaims the gutter a height-capped poster leaves, at the pane the app actually grants", () => {
    // The measurement the layout exists for, re-derived after the width cap moved: a 30-row
    // terminal at 160 columns is contentWidth 141, and the pane it grants is 84 — 80 inside the
    // frame. A 2:3 poster keeps its full 17 rows there and comes back 23 wide, leaving the card
    // exactly MAX_TEXT_COLS. Under the old 60-column cap the same pane held 56 columns and the
    // card would have had 32.
    const pane = previewLayout(141, true, 17);
    expect(pane?.pane).toBe(84);
    const budget = posterBudget(84, 17, true);
    expect(budget).toEqual({ cols: 51, rows: 17 });
    const fit = fitCells(120, 180, budget?.cols ?? 0, budget?.rows ?? 0);
    expect(fit).toEqual({ cols: 23, rows: 17 });
    expect(splitTextCols(80, fit.cols)).toBe(MAX_TEXT_COLS);
  });
});
