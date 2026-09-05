import { describe, it, expect } from "vitest";
import { dueSeeds, seedLimitFor, type ReapableQueue } from "./seed-reaper";

const HOUR = 3_600_000;

function queue(
  seeds: { id: string; name: string; dir: string; status: string }[],
  history: { id: string; completedAt: number; seedTimeMs?: number }[],
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

describe("dueSeeds with per-torrent limits", () => {
  const now = 100 * HOUR;
  const seeding = (id: string) => ({ id, name: id, dir: "/d", status: "seeding" });

  it("a torrent's own limit wins over the daemon-wide one, in both directions", () => {
    const q = queue(
      [seeding("longer"), seeding("shorter"), seeding("inherits")],
      [
        { id: "longer", completedAt: now - 5 * HOUR, seedTimeMs: 24 * HOUR },
        { id: "shorter", completedAt: now - 5 * HOUR, seedTimeMs: HOUR },
        { id: "inherits", completedAt: now - 5 * HOUR },
      ],
    );
    // Daemon says 2h: "longer" (24h) is kept, "shorter" (1h) and the
    // inheriting one (2h) are due.
    expect(dueSeeds(q, 2 * HOUR, now).map((s) => s.id)).toEqual(["shorter", "inherits"]);
  });

  it("acts on a torrent's own limit even when the daemon has none", () => {
    const q = queue(
      [seeding("capped"), seeding("free")],
      [
        { id: "capped", completedAt: now - 3 * HOUR, seedTimeMs: HOUR },
        { id: "free", completedAt: 0 },
      ],
    );
    expect(dueSeeds(q, 0, now).map((s) => s.id)).toEqual(["capped"]);
  });

  it("0 on the torrent means never stop it, whatever the daemon says", () => {
    const q = queue([seeding("forever")], [{ id: "forever", completedAt: 0, seedTimeMs: 0 }]);
    expect(dueSeeds(q, HOUR, now)).toEqual([]);
  });

  it("with no limit anywhere nothing is ever due", () => {
    const q = queue([seeding("a")], [{ id: "a", completedAt: 0 }]);
    expect(dueSeeds(q, 0, now)).toEqual([]);
  });

  it("seedLimitFor prefers the torrent's own value, including 0", () => {
    expect(seedLimitFor(undefined, HOUR)).toBe(HOUR);
    expect(seedLimitFor(2 * HOUR, HOUR)).toBe(2 * HOUR);
    expect(seedLimitFor(0, HOUR)).toBe(0);
    expect(seedLimitFor(undefined, 0)).toBe(0);
  });
});
