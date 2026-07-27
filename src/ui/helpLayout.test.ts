import { describe, it, expect } from "vitest";
import { MEASURED, pickLayout } from "./helpLayout";

describe("help layout measurement", () => {
  it("derives packing widths and grid heights from HELP_GROUPS", () => {
    expect(MEASURED.map((m) => m.width)).toEqual([138, 117, 78, 42]);
    expect(MEASURED.map((m) => m.gridH)).toEqual([10, 15, 19, 32]);
  });

  it("picks the widest packing that fits inside cols - 2", () => {
    expect(pickLayout(160).layout).toHaveLength(4);
    expect(pickLayout(140).layout).toHaveLength(4);
    expect(pickLayout(139).layout).toHaveLength(3);
    expect(pickLayout(119).layout).toHaveLength(3);
    expect(pickLayout(118).layout).toHaveLength(2);
    expect(pickLayout(80).layout).toHaveLength(2);
    expect(pickLayout(79).layout).toHaveLength(1);
    expect(pickLayout(78).layout).toHaveLength(1);
    expect(pickLayout(40).layout).toHaveLength(1);
  });
});

