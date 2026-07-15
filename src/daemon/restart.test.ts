import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { isAlive, listRunDescriptors, restartDaemon } from "./restart";
import type { RunDescriptor } from "./daemonize";

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

describe("restartDaemon", () => {
  it("returns null when the recorded process is already gone", async () => {
    const dead: RunDescriptor = {
      name: "watch",
      pid: 2 ** 30,
      argv: ["a", "watch", "/srv"],
      cwd: "/srv",
      startedAt: 0,
    };
    expect(await restartDaemon(dead)).toBeNull();
  });
});
