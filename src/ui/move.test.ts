import { describe, it, expect } from "vitest";
import { wrapStep, windowStart, resultsPanelOuter } from "./move";

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
