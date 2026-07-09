import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const spawn = vi.fn();

vi.mock("node:child_process", () => ({ spawn }));

describe("writeClipboard file fallback", () => {
  const originalPlatform = process.platform;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "torlnk-clip-"));
    process.env.TORLINK_STATE_DIR = tmpDir;
    Object.defineProperty(process, "platform", { value: "linux" });
    vi.resetModules();
    spawn.mockReset();
    spawn.mockImplementation(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdin: { end: () => void };
        stdout: EventEmitter;
        kill: () => void;
      };
      proc.stdout = new EventEmitter();
      proc.kill = vi.fn();
      proc.stdin = {
        end: vi.fn(() => queueMicrotask(() => proc.emit("exit", 1))),
      };
      return proc;
    });
  });

  afterEach(async () => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    delete process.env.TORLINK_STATE_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes to clipboard.txt when OS clipboard tools fail", async () => {
    const { writeClipboard, clipboardFallbackFile } = await import("./clipboard");
    const magnet = "magnet:?xt=urn:btih:abc";
    await expect(writeClipboard(magnet)).resolves.toBe(true);
    const file = clipboardFallbackFile();
    expect(file).toBeTruthy();
    await expect(fs.readFile(file!, "utf8")).resolves.toBe(magnet);
  });
});
