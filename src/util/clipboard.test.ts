import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const spawn = vi.fn();

vi.mock("node:child_process", () => ({ spawn }));

describe("writeClipboard", () => {
  it("writes text to the first available Linux clipboard command", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "linux" });
    try {
      spawn.mockImplementation((cmd: string) => {
        const proc = new EventEmitter() as EventEmitter & {
          stdin: { end: (value: string) => void };
          stdout: EventEmitter;
          kill: () => void;
        };
        proc.stdout = new EventEmitter();
        proc.kill = vi.fn();
        proc.stdin = {
          end: vi.fn(() => {
            queueMicrotask(() => proc.emit("close", cmd === "wl-copy" ? 0 : 1));
          }),
        };
        return proc;
      });

      const { writeClipboard } = await import("./clipboard");

      await expect(writeClipboard("magnet:?xt=urn:btih:abc")).resolves.toBe(true);
      expect(spawn).toHaveBeenCalledWith("wl-copy", [], { windowsHide: true });
      expect(spawn.mock.results[0]?.value.stdin.end).toHaveBeenCalledWith(
        "magnet:?xt=urn:btih:abc",
      );
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
      vi.resetModules();
      spawn.mockReset();
    }
  });
});
