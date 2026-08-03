import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  isWatchCandidate,
  firstMeaningfulLine,
  processFile,
  PROCESSED_DIR,
  FAILED_DIR,
} from "./watch";
import type { Runtime } from "./runtime";

const HASH = "abcdef0123456789abcdef0123456789abcdef01";
const MAGNET = `magnet:?xt=urn:btih:${HASH}&dn=Example`;

describe("isWatchCandidate", () => {
  it("accepts torrent/magnet/txt files", () => {
    expect(isWatchCandidate("Foo.torrent")).toBe(true);
    expect(isWatchCandidate("Foo.magnet")).toBe(true);
    expect(isWatchCandidate("Foo.txt")).toBe(true);
    expect(isWatchCandidate("Foo.MAGNET")).toBe(true);
  });
  it("ignores partial writes, dotfiles, and other extensions", () => {
    expect(isWatchCandidate("Foo.torrent.part")).toBe(false);
    expect(isWatchCandidate(".hidden.magnet")).toBe(false);
    expect(isWatchCandidate("movie.mkv")).toBe(false);
  });
});

describe("firstMeaningfulLine", () => {
  it("returns the first non-blank, non-comment line", () => {
    expect(firstMeaningfulLine("\n\n# a comment\n  magnet:?x  \nsecond")).toBe("magnet:?x");
  });
  it("returns null when there is nothing usable", () => {
    expect(firstMeaningfulLine("\n  \n# only a comment\n")).toBeNull();
  });
});

describe("processFile", () => {
  let dir: string;
  let downloadDir: string;
  let add: ReturnType<typeof vi.fn>;
  let runtime: Runtime;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-watch-"));
    downloadDir = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-dl-"));
    add = vi.fn();
    runtime = {
      queue: { has: () => false, add } as unknown as Runtime["queue"],
      downloadDir,
    };
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(downloadDir, { recursive: true, force: true }).catch(() => {});
  });

  it("adds a magnet from a .magnet file and archives it to .processed", async () => {
    await fs.writeFile(path.join(dir, "drop.magnet"), `${MAGNET}\n`);
    const outcome = await processFile(runtime, dir, "drop.magnet");
    expect(outcome).toBe("added");
    expect(add).toHaveBeenCalledOnce();
    // Original is gone; a timestamped copy lands in .processed.
    expect(await fs.readdir(dir)).not.toContain("drop.magnet");
    const archived = await fs.readdir(path.join(dir, PROCESSED_DIR));
    expect(archived.some((f) => f.endsWith("drop.magnet"))).toBe(true);
  });

  it("routes an unparseable file to .failed without adding", async () => {
    await fs.writeFile(path.join(dir, "junk.txt"), "not a magnet at all");
    const outcome = await processFile(runtime, dir, "junk.txt");
    expect(outcome).toBe("invalid");
    expect(add).not.toHaveBeenCalled();
    const failed = await fs.readdir(path.join(dir, FAILED_DIR));
    expect(failed.some((f) => f.endsWith("junk.txt"))).toBe(true);
  });
});
