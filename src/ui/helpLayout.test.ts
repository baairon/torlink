import { describe, it, expect } from "vitest";
import { MEASURED, pickLayout } from "./helpLayout";

describe("help layout measurement", () => {
  it("derives packing widths and grid heights from HELP_GROUPS", () => {
    expect(MEASURED.map((m) => m.width)).toEqual([135, 114, 77, 41]);
    expect(MEASURED.map((m) => m.gridH)).toEqual([9, 14, 18, 31]);
  });

  it("picks the widest packing that fits inside cols - 2", () => {
    expect(pickLayout(160).layout).toHaveLength(4);
    expect(pickLayout(136).layout).toHaveLength(3);
    expect(pickLayout(135).layout).toHaveLength(3);
    expect(pickLayout(115).layout).toHaveLength(2);
    expect(pickLayout(114).layout).toHaveLength(2);
    expect(pickLayout(80).layout).toHaveLength(2);
    expect(pickLayout(79).layout).toHaveLength(2);
    expect(pickLayout(78).layout).toHaveLength(1);
    expect(pickLayout(40).layout).toHaveLength(1);
  });
});
