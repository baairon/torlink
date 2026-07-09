import { describe, it, expect } from "vitest";
import { parseDuration } from "./duration";

describe("parseDuration", () => {
  it("parses units s/m/h/d", () => {
    expect(parseDuration("90s")).toBe(90_000);
    expect(parseDuration("30m")).toBe(1_800_000);
    expect(parseDuration("1h")).toBe(3_600_000);
    expect(parseDuration("2d")).toBe(172_800_000);
  });
  it("treats a bare number as seconds", () => {
    expect(parseDuration("3600")).toBe(3_600_000);
  });
  it("is case-insensitive and trims", () => {
    expect(parseDuration("  1H ")).toBe(3_600_000);
  });
  it("returns null for junk", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("1w")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("1.5h")).toBeNull();
  });
});
