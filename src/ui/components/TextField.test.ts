import { describe, it, expect } from "vitest";
import { maskText } from "./TextField";

describe("maskText", () => {
  it("replaces every character with a bullet", () => {
    expect(maskText("hunter2")).toBe("•••••••");
  });

  it("returns an empty string for empty input", () => {
    expect(maskText("")).toBe("");
  });
});
