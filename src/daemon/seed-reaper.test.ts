import { describe, it, expect } from "vitest";
import { dueSeeds, type ReapableQueue } from "./seed-reaper";

const HOUR = 3_600_000;

function queue(
  seeds: { id: string; name: string; dir: string; status: string }[],
  history: { id: string; completedAt: number }[],
): ReapableQueue {
  return {
    getSeeds: () => seeds,
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
