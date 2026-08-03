import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// The marker lives at a fixed path derived from TORLINK_STATE_DIR at module
// init, and other suites (persistSync tests) legitimately disarm it. Each test
// here gets a private state dir + fresh module instances so parallel test
// files can never race on the shared marker.
async function isolated() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-bootguard-"));
  vi.stubEnv("TORLINK_STATE_DIR", dir);
  vi.resetModules();
  const paths = await import("../config/paths");
  const bootguard = await import("./bootguard");
  return { dir, paths, bootguard };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("boot crash breaker", () => {
  it("arms, detects, and disarms the marker", async () => {
    const { dir, paths, bootguard } = await isolated();
    try {
      expect(bootguard.wasBootInterrupted()).toBe(false);
      bootguard.armBootMarker();
      expect(existsSync(paths.bootMarkerFile)).toBe(true);
      expect(bootguard.wasBootInterrupted()).toBe(true);
      bootguard.disarmBootMarker();
      expect(bootguard.wasBootInterrupted()).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("arming twice and disarming a missing marker never throw", async () => {
    const { dir, bootguard } = await isolated();
    try {
      bootguard.armBootMarker();
      expect(() => bootguard.armBootMarker()).not.toThrow();
      bootguard.disarmBootMarker();
      expect(() => bootguard.disarmBootMarker()).not.toThrow();
      expect(bootguard.wasBootInterrupted()).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("creates the data dir on arm when nothing has persisted yet", async () => {
    const { dir, bootguard } = await isolated();
    try {
      // A first-ever boot has no data dir at all; arming must create it
      // rather than fail quietly and blind the breaker.
      bootguard.armBootMarker();
      expect(bootguard.wasBootInterrupted()).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
