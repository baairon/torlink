import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import {
  isAlive,
  listRunDescriptors,
  processStartTime,
  restartDaemon,
  sameRecordedProcess,
} from "./restart";
import { pidPathFor, runPathFor, type RunDescriptor } from "./daemonize";

describe("isAlive", () => {
  it("is true for this process and false for a free pid", () => {
    expect(isAlive(process.pid)).toBe(true);
    expect(isAlive(2 ** 30)).toBe(false); // no process owns this
    expect(isAlive(0)).toBe(false);
    expect(isAlive(-1)).toBe(false);
  });
});

describe("listRunDescriptors", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "torlink-restart-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (name: string, body: unknown): void =>
    fs.writeFileSync(path.join(dir, `${name}.run.json`), JSON.stringify(body));

  it("reads valid descriptors and skips everything else", () => {
    write("watch", { name: "watch", pid: 111, argv: ["a", "watch", "/srv"], cwd: "/srv", startedAt: 1 });
    write("serve", { name: "serve", pid: 222, argv: ["a", "serve"], cwd: "/opt" });
    fs.writeFileSync(path.join(dir, "watch.log"), "noise");
    fs.writeFileSync(path.join(dir, "broken.run.json"), "{ not json");

    const got = listRunDescriptors(dir).sort((a, b) => a.pid - b.pid);
    expect(got.map((d) => d.name)).toEqual(["watch", "serve"]);
    expect(got[0]).toMatchObject({ pid: 111, cwd: "/srv" });
    expect(got[1]!.startedAt).toBe(0); // missing startedAt defaults to 0
  });

  it("returns [] when the directory is absent", () => {
    expect(listRunDescriptors(path.join(dir, "nope"))).toEqual([]);
  });
});

describe("processStartTime", () => {
  it("returns a plausible start time for this process and null for a free pid", () => {
    const self = processStartTime(process.pid);
    expect(self).not.toBeNull();
    // Within the last hour, and not in the future.
    expect(Math.abs(Date.now() - self!)).toBeLessThan(3_600_000);
    expect(processStartTime(2 ** 30)).toBeNull();
    expect(processStartTime(0)).toBeNull();
    expect(processStartTime(-3)).toBeNull();
  });
});

describe("sameRecordedProcess", () => {
  const desc = (startedAt: number): RunDescriptor => ({
    name: "watch",
    pid: 4242,
    argv: ["a", "watch", "/srv"],
    cwd: "/srv",
    startedAt,
  });

  it("accepts a process whose start time matches the descriptor", () => {
    const t = Date.now();
    expect(sameRecordedProcess(desc(t), () => t - 500)).toBe(true);
  });

  it("rejects a pid recycled after the daemon died (start time too new)", () => {
    const t = Date.now();
    expect(sameRecordedProcess(desc(t), () => t + 60_000)).toBe(false);
  });

  it("rejects a process far older than the descriptor", () => {
    const t = Date.now();
    expect(sameRecordedProcess(desc(t), () => t - 3_600_000)).toBe(false);
  });

  it("rejects when the start time is unavailable or never recorded", () => {
    const t = Date.now();
    expect(sameRecordedProcess(desc(t), () => null)).toBe(false);
    expect(sameRecordedProcess(desc(0), () => t)).toBe(false);
  });
});

describe("restartDaemon", () => {
  const desc = (pid: number): RunDescriptor => ({
    name: "watch",
    pid,
    argv: ["a", "watch", "/srv"],
    cwd: "/srv",
    startedAt: 0,
  });

  it("spawns nothing when the recorded process is already gone", async () => {
    expect(await restartDaemon(desc(2 ** 30))).toEqual({ newPid: null, stillRunning: false });
  });

  it("never signals a stranger process that recycled the daemon's pid", async () => {
    const killed: Array<[number, string]> = [];
    const spawned: string[] = [];
    // Point the stale-record cleanup at real files we can observe.
    const name = "stale-pid-test";
    fs.mkdirSync(path.dirname(runPathFor(name)), { recursive: true });
    fs.writeFileSync(runPathFor(name), "{}");
    fs.writeFileSync(pidPathFor(name), "4242\n");
    try {
      const res = await restartDaemon(
        { ...desc(4242), name, startedAt: Date.now() },
        {
          isAliveImpl: () => true, // pid exists…
          sameProcessImpl: () => false, // …but belongs to someone else
          killImpl: (pid, signal) => killed.push([pid, signal]),
          spawnImpl: (n) => {
            spawned.push(n);
            return 1;
          },
        },
      );
      expect(res).toEqual({ newPid: null, stillRunning: false });
      expect(killed).toEqual([]); // no SIGTERM to the stranger
      expect(spawned).toEqual([]); // and no surprise relaunch
      expect(fs.existsSync(runPathFor(name))).toBe(false); // stale record pruned
      expect(fs.existsSync(pidPathFor(name))).toBe(false);
    } finally {
      fs.rmSync(runPathFor(name), { force: true });
      fs.rmSync(pidPathFor(name), { force: true });
    }
  });

  it("reports stillRunning instead of spawning when the old pid outlives the grace", async () => {
    const killed: Array<[number, string]> = [];
    const res = await restartDaemon(desc(4242), {
      sleep: async () => {},
      waitMs: 100,
      graceMs: 500,
      isAliveImpl: () => true, // never dies
      sameProcessImpl: () => true,
      killImpl: (pid, signal) => killed.push([pid, signal]),
    });
    expect(res).toEqual({ newPid: null, stillRunning: true });
    expect(killed).toEqual([[4242, "SIGTERM"]]);
  });

  it("waits out a slow shutdown and then relaunches", async () => {
    let aliveChecks = 0;
    const spawned: string[] = [];
    const res = await restartDaemon(desc(4242), {
      sleep: async () => {},
      waitMs: 100,
      graceMs: 10_000,
      isAliveImpl: () => ++aliveChecks < 5, // dies on the 5th check
      sameProcessImpl: () => true,
      killImpl: () => {},
      spawnImpl: (name) => {
        spawned.push(name);
        return 5151;
      },
    });
    expect(res).toEqual({ newPid: 5151, stillRunning: false });
    expect(spawned).toEqual(["watch"]);
  });
});
