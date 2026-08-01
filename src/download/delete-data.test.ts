import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { deleteSeedData } from "./delete-data";
import { getCompletedDir, getSeedingDir, getDownloadsDir } from "../config/folder";

describe("deleteSeedData", () => {
  it("returns null for invalid or empty filenames", async () => {
    expect(await deleteSeedData("/tmp", "")).toBeNull();
    expect(await deleteSeedData("/tmp", "  ")).toBeNull();
    expect(await deleteSeedData("/tmp", ".")).toBeNull();
    expect(await deleteSeedData("/tmp", "..")).toBeNull();
  });

  it("deletes data across Completed, Seeding, Downloads, and root directories", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-deltest-"));
    try {
      const fileName = "test-movie.mp4";

      const completedFile = path.join(getCompletedDir(tmpDir), fileName);
      const seedingFile = path.join(getSeedingDir(tmpDir), fileName);
      const downloadsFile = path.join(getDownloadsDir(tmpDir), fileName);
      const rootFile = path.join(tmpDir, fileName);

      await fs.mkdir(getCompletedDir(tmpDir), { recursive: true });
      await fs.mkdir(getSeedingDir(tmpDir), { recursive: true });
      await fs.mkdir(getDownloadsDir(tmpDir), { recursive: true });

      await fs.writeFile(completedFile, "completed");
      await fs.writeFile(seedingFile, "seeding");
      await fs.writeFile(downloadsFile, "downloads");
      await fs.writeFile(rootFile, "root");

      const res = await deleteSeedData(tmpDir, fileName);

      expect(res).toBe(completedFile);
      expect(await fs.stat(completedFile).then(() => true).catch(() => false)).toBe(false);
      expect(await fs.stat(seedingFile).then(() => true).catch(() => false)).toBe(false);
      expect(await fs.stat(downloadsFile).then(() => true).catch(() => false)).toBe(false);
      expect(await fs.stat(rootFile).then(() => true).catch(() => false)).toBe(false);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
