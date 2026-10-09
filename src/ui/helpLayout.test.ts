import { describe, it, expect } from "vitest";
import { MEASURED, pickLayout } from "./helpLayout";

describe("help layout measurement", () => {
  it("derives packing widths and grid heights from HELP_GROUPS", () => {
    expect(MEASURED.map((m) => m.width)).toEqual([134, 108, 77, 41]);
    // Heights track HELP_GROUPS directly: the Search group is the tallest in every packing, so
    // the pane's three rows — i to toggle it, → to focus it, ← to leave — added two more on top
    // of the toggle Task 5 brought. The widths did not move with any of them: a single arrow
    // glyph is as wide as every other Search key, and both new labels are shorter than that
    // group's longest ("Download (shift+d: folder)").
    expect(MEASURED.map((m) => m.gridH)).toEqual([13, 18, 22, 35]);
  });

  it("picks the widest packing that fits inside cols - 2", () => {
    expect(pickLayout(160).layout).toHaveLength(4);
    expect(pickLayout(136).layout).toHaveLength(4);
    expect(pickLayout(135).layout).toHaveLength(3);
    expect(pickLayout(110).layout).toHaveLength(3);
    expect(pickLayout(109).layout).toHaveLength(2);
    expect(pickLayout(80).layout).toHaveLength(2);
    expect(pickLayout(79).layout).toHaveLength(2);
    expect(pickLayout(78).layout).toHaveLength(1);
    expect(pickLayout(40).layout).toHaveLength(1);
  });
});
