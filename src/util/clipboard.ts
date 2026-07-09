import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    let out = "";
    try {
      const proc = spawn(cmd, args, { windowsHide: true });
      const timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {}
        resolve("");
      }, 4000);
      timer.unref?.();
      proc.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
      proc.on("error", () => {
        clearTimeout(timer);
        resolve("");
      });
      proc.on("close", () => {
        clearTimeout(timer);
        resolve(out);
      });
    } catch {
      resolve("");
    }
  });
}

function write(cmd: string, args: string[], text: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(cmd, args, { windowsHide: true });
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const done = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {}
        done(false);
      }, 4000);
      timer.unref?.();
      proc.on("error", () => done(false));
      const onFinish = (code: number | null = 0): void => done(code === 0);
      proc.on("exit", onFinish);
      proc.on("close", onFinish);
      proc.stdin?.end(text);
    } catch {
      resolve(false);
    }
  });
}

const LINUX_READ: [string, string[]][] = [
  ["wl-paste", ["--no-newline"]],
  ["xclip", ["-selection", "clipboard", "-o"]],
  ["xsel", ["-b"]],
];

const LINUX_WRITE: [string, string[]][] = [
  ["wl-copy", []],
  ["xclip", ["-selection", "clipboard"]],
  ["xsel", ["-b", "-i"]],
];

/** Headless fallback (Docker/SSH): magnet saved to a file the user can read. */
export function clipboardFallbackFile(): string | null {
  const explicit = process.env.TORLINK_CLIPBOARD_FILE?.trim();
  if (explicit) return explicit;
  const state = process.env.TORLINK_STATE_DIR?.trim();
  if (state) return path.join(state, "clipboard.txt");
  return null;
}

async function writeClipboardFile(text: string): Promise<boolean> {
  const file = clipboardFallbackFile();
  if (!file) return false;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text, "utf8");
    return true;
  } catch {
    return false;
  }
}

export async function readClipboard(): Promise<string> {
  if (process.platform === "win32") {
    return (await run("powershell", ["-NoProfile", "-Command", "Get-Clipboard"])).trim();
  }
  if (process.platform === "darwin") {
    return (await run("pbpaste", [])).trim();
  }
  for (const [cmd, args] of LINUX_READ) {
    const out = (await run(cmd, args)).trim();
    if (out) return out;
  }
  const file = clipboardFallbackFile();
  if (file) {
    try {
      return (await fs.readFile(file, "utf8")).trim();
    } catch {
      return "";
    }
  }
  return "";
}

export async function writeClipboard(text: string): Promise<boolean> {
  if (process.platform === "win32") {
    return write(
      "powershell",
      ["-NoProfile", "-Command", "Set-Clipboard -Value ([Console]::In.ReadToEnd())"],
      text,
    );
  }
  if (process.platform === "darwin") {
    return write("pbcopy", [], text);
  }
  for (const [cmd, args] of LINUX_WRITE) {
    if (await write(cmd, args, text)) return true;
  }
  return writeClipboardFile(text);
}
