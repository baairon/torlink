import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const spawn = vi.fn();
const existsSync = vi.fn();

vi.mock("node:child_process", () => ({ spawn }));
vi.mock("node:fs", () => ({ existsSync }));

type FakeProc = EventEmitter & { kill: () => void };

function fakeProc(code: number): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.kill = vi.fn();
  queueMicrotask(() => proc.emit("close", code));
  return proc;
}

function onPlatform(platform: string): () => void {
  const original = process.platform;
  Object.defineProperty(process, "platform", { value: platform });
  return () => {
    Object.defineProperty(process, "platform", { value: original });
    vi.resetModules();
    spawn.mockReset();
    existsSync.mockReset();
  };
}

describe("openFolder", () => {
  it("falls back to the next Linux opener when the first fails", async () => {
    const restore = onPlatform("linux");
    try {
      existsSync.mockReturnValue(true);
      spawn.mockImplementation((cmd: string) => fakeProc(cmd === "gio" ? 0 : 1));

      const { openFolder } = await import("./openFolder");

      await expect(openFolder("/home/me/Downloads/torlink")).resolves.toBe(true);
      expect(spawn).toHaveBeenCalledWith("xdg-open", ["/home/me/Downloads/torlink"]);
      expect(spawn).toHaveBeenCalledWith("gio", ["open", "/home/me/Downloads/torlink"]);
    } finally {
      restore();
    }
  });

  it("treats explorer's nonzero exit as success on Windows", async () => {
    const restore = onPlatform("win32");
    try {
      existsSync.mockReturnValue(true);
      spawn.mockImplementation(() => fakeProc(1));

      const { openFolder } = await import("./openFolder");

      await expect(openFolder("C:\\Users\\me\\Downloads\\torlink")).resolves.toBe(true);
      expect(spawn).toHaveBeenCalledWith("explorer", ["C:\\Users\\me\\Downloads\\torlink"]);
    } finally {
      restore();
    }
  });

  it("reports failure for a folder that no longer exists, without spawning", async () => {
    const restore = onPlatform("win32");
    try {
      existsSync.mockReturnValue(false);

      const { openFolder } = await import("./openFolder");

      await expect(openFolder("C:\\gone")).resolves.toBe(false);
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});
