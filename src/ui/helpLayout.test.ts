import { describe, it, expect } from "vitest";
import { MEASURED, pickLayout } from "./helpLayout";

describe("help layout measurement", () => {
  it("derives packing widths and grid heights from HELP_GROUPS", () => {
    expect(MEASURED.map((m) => m.width)).toEqual([140, 114, 83, 44]);
    expect(MEASURED.map((m) => m.gridH)).toEqual([11, 17, 22, 38]);
  });

  it("picks the widest packing that fits inside cols - 2", () => {
    expect(pickLayout(160).layout).toHaveLength(4);
    expect(pickLayout(142).layout).toHaveLength(4);
    expect(pickLayout(141).layout).toHaveLength(3);
    expect(pickLayout(116).layout).toHaveLength(3);
    expect(pickLayout(115).layout).toHaveLength(2);
    expect(pickLayout(85).layout).toHaveLength(2);
    expect(pickLayout(84).layout).toHaveLength(1);
    expect(pickLayout(83).layout).toHaveLength(1);
    expect(pickLayout(46).layout).toHaveLength(1);
  });
});
