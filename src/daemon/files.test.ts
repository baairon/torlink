import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { contentType, safeResolve, parseRange, sendListing } from "./files";

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

describe("sendListing", () => {
  it("filters root directory listing to only Completed, Downloads, and Seeding", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-files-listing-"));
    try {
      await fs.mkdir(path.join(tmpDir, "Completed"), { recursive: true });
      await fs.mkdir(path.join(tmpDir, "Downloads"), { recursive: true });
      await fs.mkdir(path.join(tmpDir, "Seeding"), { recursive: true });
      await fs.mkdir(path.join(tmpDir, "UnrelatedFolder"), { recursive: true });
      await fs.writeFile(path.join(tmpDir, "secret.txt"), "hello");

      let statusCode = 0;
      let headers: Record<string, string> = {};
      let responseData = "";

      const req = { headers: { accept: "application/json" } } as unknown as import("node:http").IncomingMessage;
      const res = {
        writeHead: (code: number, h: Record<string, string>) => {
          statusCode = code;
          headers = h;
        },
        end: (data: string) => {
          responseData = data;
        },
      } as unknown as import("node:http").ServerResponse;

      await sendListing(req, res, tmpDir, tmpDir, "GET");

      expect(statusCode).toBe(200);
      expect(headers["Content-Type"]).toBe("application/json");

      const parsed = JSON.parse(responseData) as { entries: Array<{ name: string; type: string }> };
      const names = parsed.entries.map((e) => e.name).sort();
      expect(names).toEqual(["Completed", "Downloads", "Seeding"]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("does not filter listing when requesting a subdirectory", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-files-subdir-"));
    try {
      const downloadsDir = path.join(tmpDir, "Downloads");
      await fs.mkdir(downloadsDir, { recursive: true });
      await fs.writeFile(path.join(downloadsDir, "Movie.mkv"), "movie");
      await fs.mkdir(path.join(downloadsDir, "SubFolder"), { recursive: true });

      let responseData = "";
      const req = { headers: { accept: "application/json" } } as unknown as import("node:http").IncomingMessage;
      const res = {
        writeHead: () => {},
        end: (data: string) => {
          responseData = data;
        },
      } as unknown as import("node:http").ServerResponse;

      await sendListing(req, res, downloadsDir, tmpDir, "GET");

      const parsed = JSON.parse(responseData) as { entries: Array<{ name: string; type: string }> };
      const names = parsed.entries.map((e) => e.name).sort();
      expect(names).toEqual(["Movie.mkv", "SubFolder"]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

