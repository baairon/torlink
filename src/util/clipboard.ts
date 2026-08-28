import { spawn } from "node:child_process";

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
  return "";
}

async function writeNative(text: string): Promise<boolean> {
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
  return false;
}

// OSC 52 asks the terminal emulator itself to set the clipboard:
// ESC ] 52 ; c ; <base64> BEL. It needs no helper binary, which is the whole
// point — it is the one mechanism that still works when wl-copy, xclip and xsel
// are all absent, and the only one that reaches the clipboard of the machine the
// user is actually sitting at when torlink runs over SSH. torlink already knows
// this sequence from the other direction: stripControl() in util/format.ts
// exists so a hijacked source cannot smuggle one in through a name or a magnet.
//
// A terminal never acknowledges OSC 52, so `true` here means the request
// reached the terminal, not that the clipboard now holds the text. That is the
// honest limit of the mechanism, and it beats telling someone the copy failed
// when it almost certainly did not.

// Terminals cap the payload they will accept. A silently truncated paste is
// worse than no paste, so anything past the cap is left to the helper binaries.
// A magnet with every default tracker is well under 2 KB.
const OSC52_MAX_BASE64 = 100_000;

function ttyStream(): NodeJS.WriteStream | null {
  if (process.stderr.isTTY) return process.stderr;
  if (process.stdout.isTTY) return process.stdout;
  return null;
}

function writeOsc52(text: string): boolean {
  const stream = ttyStream();
  if (!stream) return false;
  const payload = Buffer.from(text, "utf8").toString("base64");
  if (payload.length > OSC52_MAX_BASE64) return false;
  const seq = `\u001b]52;c;${payload}\u0007`;
  try {
    // tmux drops an application's OSC 52 unless set-clipboard is `on`, and its
    // default is `external`. Wrapping it in a DCS passthrough hands the sequence
    // to the outer terminal whatever that setting is. TMUX is set by tmux itself,
    // so this never fires anywhere else.
    stream.write(process.env.TMUX ? `\u001bPtmux;\u001b${seq}\u001b\\` : seq);
    return true;
  } catch {
    return false;
  }
}

// Over SSH the helper binaries set the clipboard of the machine torlink is
// running on, not the one in front of the user, so the magnet lands somewhere
// they can never paste from — a success that is really a failure. Where that is
// the situation, ask the terminal first.
function isRemoteSession(): boolean {
  return Boolean(process.env.SSH_TTY || process.env.SSH_CONNECTION);
}

export async function writeClipboard(text: string): Promise<boolean> {
  if (isRemoteSession() && writeOsc52(text)) return true;
  if (await writeNative(text)) return true;
  return writeOsc52(text);
}

