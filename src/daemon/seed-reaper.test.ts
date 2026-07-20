import { describe, it, expect, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { dueSeeds, startSeedReaper, type ReapableQueue } from "./seed-reaper";

const HOUR = 3_600_000;

function queue(
  seeds: { id: string; name: string; dir: string; status: string }[],
  history: { id: string; completedAt: number }[],
): ReapableQueue {
  return {
    getSeeds: () => seeds,
    getSeed: (id: string) => seeds.find((s) => s.id === id),
    getHistory: () => history,
    stopSeeding: () => {},
  };
}

describe("dueSeeds", () => {
  const now = 10 * HOUR;

  it("returns seeds finished longer ago than the limit", () => {
    const q = queue(
      [
        { id: "a", name: "Old", dir: "/d", status: "seeding" },
        { id: "b", name: "Fresh", dir: "/d", status: "seeding" },
      ],
      [
        { id: "a", completedAt: now - 2 * HOUR },
        { id: "b", completedAt: now - 10 * 60_000 }, // 10 min ago
      ],
    );
    expect(dueSeeds(q, HOUR, now).map((s) => s.id)).toEqual(["a"]);
  });

  it("ignores non-seeding entries (paused/missing)", () => {
    const q = queue(
      [{ id: "a", name: "Paused", dir: "/d", status: "paused" }],
      [{ id: "a", completedAt: 0 }],
    );
    expect(dueSeeds(q, HOUR, now)).toEqual([]);
  });

  it("treats unknown completion time as just-finished (not due)", () => {
    const q = queue([{ id: "a", name: "NoHist", dir: "/d", status: "seeding" }], []);
    expect(dueSeeds(q, HOUR, now)).toEqual([]);
  });

  it("carries the dir/name through for optional file deletion", () => {
    const q = queue(
      [{ id: "a", name: "Movie", dir: "/downloads", status: "seeding" }],
      [{ id: "a", completedAt: now - 5 * HOUR }],
    );
    expect(dueSeeds(q, HOUR, now)).toEqual([{ id: "a", name: "Movie", dir: "/downloads" }]);
  });
});

describe("startSeedReaper file deletion", () => {
  let dir: string;
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  const mkDue = async (): Promise<{ dir: string; seed: { id: string; name: string; dir: string; status: string } }> => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-reap-"));
    await fs.writeFile(path.join(dir, "Movie"), "data");
    return { dir, seed: { id: "a", name: "Movie", dir, status: "seeding" } };
  };

  it("deletes the files of a due seed when deleteFiles is on", async () => {
    const { dir, seed } = await mkDue();
    const logs: string[] = [];
    const q: ReapableQueue = {
      getSeeds: () => [seed],
      getSeed: (id) => (id === "a" ? seed : undefined),
      getHistory: () => [{ id: "a", completedAt: Date.now() - 5 * HOUR }],
      stopSeeding: () => {
        seed.status = "paused";
      },
    };
    const stop = startSeedReaper(q, HOUR, { deleteFiles: true, log: (m) => logs.push(m) });
    stop();
    await new Promise((r) => setTimeout(r, 50)); // let the async tick finish
    expect(logs.some((m) => m.includes("deleted files"))).toBe(true);
    await expect(fs.stat(path.join(dir, "Movie"))).rejects.toThrow();
  });

  it("a start-seed landing after the stop wins over the pending delete", async () => {
    const { dir, seed } = await mkDue();
    const logs: string[] = [];
    const q: ReapableQueue = {
      getSeeds: () => [seed],
      getSeed: (id) => (id === "a" ? seed : undefined),
      getHistory: () => [{ id: "a", completedAt: Date.now() - 5 * HOUR }],
      stopSeeding: () => {
        seed.status = "seeding"; // immediately re-started (POST /control start-seed)
      },
    };
    const stop = startSeedReaper(q, HOUR, { deleteFiles: true, log: (m) => logs.push(m) });
    stop();
    await new Promise((r) => setTimeout(r, 50));
    expect(logs.some((m) => m.includes("deleted files"))).toBe(false);
    await expect(fs.stat(path.join(dir, "Movie"))).resolves.toBeTruthy();
  });
});
