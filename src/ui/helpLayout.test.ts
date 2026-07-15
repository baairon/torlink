import { describe, it, expect } from "vitest";
import { MEASURED, pickLayout } from "./helpLayout";

describe("help layout measurement", () => {
  it("derives packing widths and grid heights from HELP_GROUPS", () => {
    expect(MEASURED.map((m) => m.width)).toEqual([122, 101, 65, 41]);
    expect(MEASURED.map((m) => m.gridH)).toEqual([9, 12, 17, 31]);
  });

  it("picks the widest packing that fits inside cols - 2", () => {
    expect(pickLayout(140).layout).toHaveLength(4);
    expect(pickLayout(124).layout).toHaveLength(4);
    expect(pickLayout(123).layout).toHaveLength(3);
    expect(pickLayout(103).layout).toHaveLength(3);
    expect(pickLayout(102).layout).toHaveLength(2);
    expect(pickLayout(80).layout).toHaveLength(2);
    expect(pickLayout(67).layout).toHaveLength(2);
    expect(pickLayout(66).layout).toHaveLength(1);
    expect(pickLayout(60).layout).toHaveLength(1);
    expect(pickLayout(40).layout).toHaveLength(1);
  });
});
