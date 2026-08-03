import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Same isolation story as bootguard.test.ts: the log path is derived from
// TORLINK_STATE_DIR at module init, so each test gets a private dir and fresh
// module instances.
async function isolated() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-crashlog-"));
  vi.stubEnv("TORLINK_STATE_DIR", dir);
  vi.resetModules();
  const crashlog = await import("./crashlog");
  return { dir, crashlog };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("crash log", () => {
  it("appends a timestamped entry and reports success", async () => {
    const { dir, crashlog } = await isolated();
    try {
      expect(crashlog.logCrash("unhandledRejection", new Error("Chunk store init failed"))).toBe(true);
      const text = await fs.readFile(crashlog.crashLogFile, "utf8");
      expect(text).toContain("[unhandledRejection]");
      expect(text).toContain("Chunk store init failed");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("stringifies non-Error reasons instead of failing", async () => {
    const { dir, crashlog } = await isolated();
    try {
      expect(crashlog.logCrash("unhandledRejection", "plain string reason")).toBe(true);
      const text = await fs.readFile(crashlog.crashLogFile, "utf8");
      expect(text).toContain("plain string reason");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("containUnhandledRejections", () => {
  it("registers a listener whose handler logs and never throws", async () => {
    const { dir, crashlog } = await isolated();
    const before = process.listeners("unhandledRejection");
    try {
      crashlog.containUnhandledRejections();
      const added = process
        .listeners("unhandledRejection")
        .filter((l) => !before.includes(l));
      expect(added).toHaveLength(1);

      // Drive the handler directly: a real unhandled rejection would race the
      // test harness's own bookkeeping.
      const handler = added[0]! as (reason: unknown, promise: Promise<unknown>) => void;
      expect(() => handler(new Error("Invalid torrent identifier"), Promise.resolve())).not.toThrow();
      const text = await fs.readFile(crashlog.crashLogFile, "utf8");
      expect(text).toContain("Invalid torrent identifier");
    } finally {
      for (const l of process.listeners("unhandledRejection")) {
        if (!before.includes(l)) process.removeListener("unhandledRejection", l);
      }
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
