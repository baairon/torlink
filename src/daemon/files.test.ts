import { describe, it, expect } from "vitest";
import path from "node:path";
import { contentType, safeResolve, parseRange } from "./files";

describe("contentType", () => {
  it("maps known media extensions", () => {
    expect(contentType("Movie.mp4")).toBe("video/mp4");
    expect(contentType("track.MP3")).toBe("audio/mpeg");
    expect(contentType("clip.mkv")).toBe("video/x-matroska");
  });
  it("falls back to octet-stream", () => {
    expect(contentType("archive.xyz")).toBe("application/octet-stream");
    expect(contentType("noext")).toBe("application/octet-stream");
  });
});

describe("safeResolve", () => {
  const root = path.resolve("/srv/downloads");
  it("resolves a file beneath the root", () => {
    expect(safeResolve(root, "/Movie/Movie.mkv")).toBe(path.join(root, "Movie", "Movie.mkv"));
  });
  it("maps the empty path to the root itself", () => {
    expect(safeResolve(root, "/")).toBe(root);
  });
  it("rejects traversal, encoded or plain", () => {
    expect(safeResolve(root, "/../etc/passwd")).toBeNull();
    expect(safeResolve(root, "/%2e%2e/secret")).toBeNull();
    expect(safeResolve(root, "/a/../../b")).toBeNull();
  });
  it("rejects a malformed percent-encoding", () => {
    expect(safeResolve(root, "/%")).toBeNull();
  });
});

describe("parseRange", () => {
  const size = 1000;
  it("returns null with no header (send whole file)", () => {
    expect(parseRange(undefined, size)).toBeNull();
    expect(parseRange("bytes=-", size)).toBeNull();
  });
  it("parses a closed range", () => {
    expect(parseRange("bytes=0-499", size)).toEqual({ start: 0, end: 499 });
  });
  it("parses an open-ended range", () => {
    expect(parseRange("bytes=500-", size)).toEqual({ start: 500, end: 999 });
  });
  it("parses a suffix range", () => {
    expect(parseRange("bytes=-200", size)).toEqual({ start: 800, end: 999 });
  });
  it("clamps an end past the file", () => {
    expect(parseRange("bytes=900-5000", size)).toEqual({ start: 900, end: 999 });
  });
  it("flags an unsatisfiable range", () => {
    expect(parseRange("bytes=2000-3000", size)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", size)).toBe("unsatisfiable");
  });
  it("ignores a malformed header", () => {
    expect(parseRange("chunks=0-1", size)).toBeNull();
  });
});
