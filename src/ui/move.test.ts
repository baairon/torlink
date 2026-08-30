import { describe, it, expect } from "vitest";
import {
  stickCursor,
  wrapStep,
  windowStart,
  resultsPanelOuter,
  scrollStart,
  stepRegion,
} from "./move";

describe("stickCursor", () => {
  const rows = (...hashes: string[]) => hashes.map((infoHash) => ({ infoHash }));

  it("pins an untouched cursor to the top while the list reshuffles", () => {
    expect(stickCursor(rows("a", "b", "c"), null, 0)).toBe(0);
  });

  it("follows the selected row to its new index", () => {
    expect(stickCursor(rows("b", "c", "a"), "a", 0)).toBe(2);
    expect(stickCursor(rows("a", "b"), "b", 1)).toBe(1);
  });

  it("clamps when the selected row disappears", () => {
    expect(stickCursor(rows("a", "b"), "z", 5)).toBe(1);
    expect(stickCursor(rows(), "z", 3)).toBe(0);
  });
});

describe("wrapStep", () => {
  it("wraps around both ends", () => {
    expect(wrapStep(0, -1, 5)).toBe(4);
    expect(wrapStep(4, 1, 5)).toBe(0);
    expect(wrapStep(2, 1, 5)).toBe(3);
    expect(wrapStep(0, 1, 0)).toBe(0);
  });
});

describe("windowStart", () => {
  it("keeps the cursor centered within bounds", () => {
    expect(windowStart(0, 10, 5)).toBe(0);
    expect(windowStart(9, 10, 5)).toBe(5);
    expect(windowStart(5, 10, 5)).toBe(3);
    expect(windowStart(2, 4, 10)).toBe(0);
  });
});

describe("scrollStart", () => {
  it("clamps at both ends instead of wrapping", () => {
    expect(scrollStart(-3, 20, 5)).toBe(0);
    expect(scrollStart(0, 20, 5)).toBe(0);
    expect(scrollStart(7, 20, 5)).toBe(7);
    // The last window shows the final row and nothing past it.
    expect(scrollStart(15, 20, 5)).toBe(15);
    expect(scrollStart(16, 20, 5)).toBe(15);
    expect(scrollStart(999, 20, 5)).toBe(15);
  });

  it("pins to the top whenever the content fits", () => {
    expect(scrollStart(4, 5, 5)).toBe(0);
    expect(scrollStart(4, 2, 5)).toBe(0);
    expect(scrollStart(0, 0, 5)).toBe(0);
  });

  it("does not centre the way windowStart does", () => {
    // The two are not interchangeable, which is the reason both exist: a scrolled pane has no
    // cursor to centre, so row 7 of a 20-row card sits at the top of the window and not in it.
    expect(scrollStart(7, 20, 5)).toBe(7);
    expect(windowStart(7, 20, 5)).toBe(5);
  });
});

describe("stepRegion", () => {
  it("walks the three columns in both directions", () => {
    expect(stepRegion("sidebar", 1, true)).toBe("content");
    expect(stepRegion("content", 1, true)).toBe("preview");
    expect(stepRegion("preview", -1, true)).toBe("content");
    expect(stepRegion("content", -1, true)).toBe("sidebar");
  });

  it("stops at both ends rather than wrapping around the screen", () => {
    expect(stepRegion("sidebar", -1, true)).toBe("sidebar");
    expect(stepRegion("preview", 1, true)).toBe("preview");
  });

  it("keeps → a no-op in the list when the pane is not on screen", () => {
    // Exactly today's behaviour at 80 columns, on the Games tab, and with the pane toggled off.
    expect(stepRegion("content", 1, false)).toBe("content");
    expect(stepRegion("sidebar", 1, false)).toBe("content");
  });

  it("rescues focus that was inside the pane when the pane disappeared", () => {
    // A resize or the `i` toggle can take the pane away while it holds the keyboard; every key
    // that moves horizontally has to lead back out rather than into a column that is not drawn.
    expect(stepRegion("preview", -1, false)).toBe("content");
    expect(stepRegion("preview", 1, false)).toBe("content");
  });

  it("leaves the modal flag alone — it is a state, not a column", () => {
    expect(stepRegion("help", 1, true)).toBe("help");
    expect(stepRegion("help", -1, true)).toBe("help");
  });
});

describe("resultsPanelOuter", () => {
  // The results view is: search bar (searchH rows) + a 1-row gap + the panel.
  const searchH = 3;
  const resultsHeight = (listRows: number): number =>
    searchH + 1 + resultsPanelOuter(listRows, searchH);

  it("leaves a row of slack so results never exactly fill the body box (issue #21)", () => {
    // An exact fit inside the parent overflow:hidden body desyncs Ink's
    // incremental renderer and swallows a row while scrolling. The view must
    // stay strictly shorter than the row budget it is given.
    for (let listRows = 12; listRows <= 80; listRows++) {
      expect(resultsHeight(listRows)).toBeLessThan(listRows);
    }
  });

  it("uses exactly one row of slack, matching Downloads/Seeding (listRows - 1)", () => {
    for (let listRows = 12; listRows <= 80; listRows++) {
      expect(resultsHeight(listRows)).toBe(listRows - 1);
    }
  });

  it("clamps to a minimum usable panel height on tiny terminals", () => {
    expect(resultsPanelOuter(4, searchH)).toBe(5);
    expect(resultsPanelOuter(0, searchH)).toBe(5);
  });
});
