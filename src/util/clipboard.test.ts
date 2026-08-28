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
            queueMicrotask(() => proc.emit("exit", cmd === "wl-copy" ? 0 : 1));
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

type FakeProc = EventEmitter & {
  stdin: { end: (value: string) => void };
  stdout: EventEmitter;
  kill: () => void;
};

// Same shape as the mock above: every spawned command exits with `code`.
function mockSpawn(code: number): void {
  spawn.mockImplementation(() => {
    const proc = new EventEmitter() as FakeProc;
    proc.stdout = new EventEmitter();
    proc.kill = vi.fn();
    proc.stdin = { end: vi.fn(() => queueMicrotask(() => proc.emit("exit", code))) };
    return proc;
  });
}

// OSC 52 goes to the terminal, not to a child process, so the test watches the
// tty rather than node:child_process.
function captureTty(isTTY: boolean): { written: string[]; restore: () => void } {
  const written: string[] = [];
  const err = process.stderr as unknown as { isTTY?: boolean; write: unknown };
  const out = process.stdout as unknown as { isTTY?: boolean };
  const prev = { errIsTTY: err.isTTY, errWrite: err.write, outIsTTY: out.isTTY };
  err.isTTY = isTTY;
  out.isTTY = isTTY;
  err.write = (chunk: unknown) => {
    written.push(String(chunk));
    return true;
  };
  return {
    written,
    restore: () => {
      err.isTTY = prev.errIsTTY;
      err.write = prev.errWrite;
      out.isTTY = prev.outIsTTY;
    },
  };
}

async function onPlatform<T>(platform: string, run: () => Promise<T>): Promise<T> {
  const original = process.platform;
  Object.defineProperty(process, "platform", { value: platform });
  try {
    return await run();
  } finally {
    Object.defineProperty(process, "platform", { value: original });
    vi.resetModules();
    vi.unstubAllEnvs();
    spawn.mockReset();
  }
}

function decodeOsc52(seq: string): string {
  const body = seq.slice(seq.indexOf(";c;") + 3, seq.lastIndexOf("\u0007"));
  return Buffer.from(body, "base64").toString("utf8");
}

describe("writeClipboard OSC 52 fallback", () => {
  it("asks the terminal when no Linux clipboard command works", async () => {
    const tty = captureTty(true);
    try {
      await onPlatform("linux", async () => {
        vi.stubEnv("SSH_TTY", "");
        vi.stubEnv("SSH_CONNECTION", "");
        vi.stubEnv("TMUX", "");
        mockSpawn(1);
        const { writeClipboard } = await import("./clipboard");

        await expect(writeClipboard("magnet:?xt=urn:btih:abc")).resolves.toBe(true);
        // wl-copy, xclip and xsel were all tried first.
        expect(spawn).toHaveBeenCalledTimes(3);
        expect(tty.written.join("")).toBe(
          "\u001b]52;c;bWFnbmV0Oj94dD11cm46YnRpaDphYmM=\u0007",
        );
        expect(decodeOsc52(tty.written.join(""))).toBe("magnet:?xt=urn:btih:abc");
      });
    } finally {
      tty.restore();
    }
  });

  it("stays quiet when the platform command already worked", async () => {
    const tty = captureTty(true);
    try {
      await onPlatform("darwin", async () => {
        vi.stubEnv("SSH_TTY", "");
        vi.stubEnv("SSH_CONNECTION", "");
        mockSpawn(0);
        const { writeClipboard } = await import("./clipboard");

        await expect(writeClipboard("magnet:?xt=urn:btih:abc")).resolves.toBe(true);
        expect(spawn).toHaveBeenCalledWith("pbcopy", [], { windowsHide: true });
        expect(tty.written).toEqual([]);
      });
    } finally {
      tty.restore();
    }
  });

  it("prefers the terminal over the remote clipboard inside an SSH session", async () => {
    const tty = captureTty(true);
    try {
      await onPlatform("linux", async () => {
        vi.stubEnv("SSH_TTY", "/dev/pts/0");
        vi.stubEnv("TMUX", "");
        mockSpawn(0); // wl-copy would have "worked" -- on the wrong machine
        const { writeClipboard } = await import("./clipboard");

        await expect(writeClipboard("magnet:?xt=urn:btih:abc")).resolves.toBe(true);
        expect(spawn).not.toHaveBeenCalled();
        expect(decodeOsc52(tty.written.join(""))).toBe("magnet:?xt=urn:btih:abc");
      });
    } finally {
      tty.restore();
    }
  });

  it("wraps the sequence in a DCS passthrough inside tmux", async () => {
    const tty = captureTty(true);
    try {
      await onPlatform("linux", async () => {
        vi.stubEnv("SSH_TTY", "");
        vi.stubEnv("SSH_CONNECTION", "");
        vi.stubEnv("TMUX", "/tmp/tmux-1000/default,1234,0");
        mockSpawn(1);
        const { writeClipboard } = await import("./clipboard");

        await expect(writeClipboard("hi")).resolves.toBe(true);
        expect(tty.written.join("")).toBe("\u001bPtmux;\u001b\u001b]52;c;aGk=\u0007\u001b\\");
      });
    } finally {
      tty.restore();
    }
  });

  it("still reports failure when there is no terminal to ask", async () => {
    const tty = captureTty(false);
    try {
      await onPlatform("linux", async () => {
        vi.stubEnv("SSH_TTY", "");
        vi.stubEnv("SSH_CONNECTION", "");
        vi.stubEnv("TMUX", "");
        mockSpawn(1);
        const { writeClipboard } = await import("./clipboard");

        await expect(writeClipboard("magnet:?xt=urn:btih:abc")).resolves.toBe(false);
        expect(tty.written).toEqual([]);
      });
    } finally {
      tty.restore();
    }
  });
});
