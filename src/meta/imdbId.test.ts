import { describe, it, expect } from "vitest";
import { imdbFromNumeric, normalizeImdbId } from "./imdbId";

describe("normalizeImdbId", () => {
  it("accepts a well-formed id", () => {
    expect(normalizeImdbId("tt0133093")).toBe("tt0133093");
    expect(normalizeImdbId("TT0133093")).toBe("tt0133093");
    expect(normalizeImdbId("  tt0133093  ")).toBe("tt0133093");
    expect(normalizeImdbId("tt1234567890")).toBe("tt1234567890");
  });

  it("takes the series id out of an episode id", () => {
    expect(normalizeImdbId("tt0903747:5:14")).toBe("tt0903747");
  });

  it("rejects anything that would not survive being put in a url path", () => {
    expect(normalizeImdbId("../etc")).toBeUndefined();
    expect(normalizeImdbId("tt")).toBeUndefined();
    expect(normalizeImdbId("")).toBeUndefined();
    expect(normalizeImdbId("12")).toBeUndefined();
    expect(normalizeImdbId("tt0133093/../../admin")).toBeUndefined();
    expect(normalizeImdbId("tt0133093?x=1")).toBeUndefined();
    expect(normalizeImdbId("tt12345678901")).toBeUndefined();
    expect(normalizeImdbId("tt01330 93")).toBeUndefined();
    expect(normalizeImdbId(undefined)).toBeUndefined();
    expect(normalizeImdbId(133093)).toBeUndefined();
    expect(normalizeImdbId({ id: "tt0133093" })).toBeUndefined();
  });
});

describe("imdbFromNumeric", () => {
  it("prefixes and validates a numeric id", () => {
    expect(imdbFromNumeric("32308214")).toBe("tt32308214");
    expect(imdbFromNumeric(133093)).toBe("tt0133093");
    expect(imdbFromNumeric("0133093")).toBe("tt0133093");
  });

  it("rejects non-numeric input rather than forging an id", () => {
    expect(imdbFromNumeric("tt0133093")).toBeUndefined();
    expect(imdbFromNumeric("12x")).toBeUndefined();
    expect(imdbFromNumeric("")).toBeUndefined();
    expect(imdbFromNumeric("12345678901")).toBeUndefined();
    expect(imdbFromNumeric(null)).toBeUndefined();
  });
});
