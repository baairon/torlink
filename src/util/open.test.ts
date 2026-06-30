import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const spawn = vi.fn();
vi.mock("node:child_process", () => ({ spawn }));

describe("openPath", () => {
  it("spawns open on darwin", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });
    try {
      spawn.mockImplementation(() => {
        const proc = new EventEmitter() as any;
        queueMicrotask(() => proc.emit("close", 0));
        return proc;
      });

      const { openPath } = await import("./open");
      await expect(openPath("/some/path")).resolves.toBe(true);
      expect(spawn).toHaveBeenCalledWith("open", ["/some/path"], { windowsHide: true });
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
      vi.resetModules();
      spawn.mockReset();
    }
  });

  it("spawns cmd.exe on win32", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      spawn.mockImplementation(() => {
        const proc = new EventEmitter() as any;
        queueMicrotask(() => proc.emit("close", 0));
        return proc;
      });

      const { openPath } = await import("./open");
      await expect(openPath("C:\\some\\path")).resolves.toBe(true);
      expect(spawn).toHaveBeenCalledWith("cmd.exe", ["/c", "start", "", "C:\\some\\path"], { windowsHide: true });
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
      vi.resetModules();
      spawn.mockReset();
    }
  });

  it("spawns xdg-open on other platforms (e.g. linux)", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "linux" });
    try {
      spawn.mockImplementation(() => {
        const proc = new EventEmitter() as any;
        queueMicrotask(() => proc.emit("close", 0));
        return proc;
      });

      const { openPath } = await import("./open");
      await expect(openPath("/some/path")).resolves.toBe(true);
      expect(spawn).toHaveBeenCalledWith("xdg-open", ["/some/path"], { windowsHide: true });
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
      vi.resetModules();
      spawn.mockReset();
    }
  });

  it("rejects path with double quotes on win32", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      const { openPath } = await import("./open");
      await expect(openPath('C:\\some"path')).resolves.toBe(false);
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
      vi.resetModules();
      spawn.mockReset();
    }
  });

  it("returns false if spawn fails or errors", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });
    try {
      spawn.mockImplementation(() => {
        const proc = new EventEmitter() as any;
        queueMicrotask(() => proc.emit("error", new Error("spawn failed")));
        return proc;
      });

      const { openPath } = await import("./open");
      await expect(openPath("/some/path")).resolves.toBe(false);
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
      vi.resetModules();
      spawn.mockReset();
    }
  });
});
