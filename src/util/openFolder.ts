import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

function launch(cmd: string, args: string[], anyExit = false): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      // Unlike clipboard.ts, no windowsHide here: it maps to SW_HIDE in the
      // startup info, and explorer.exe honors that for the folder window
      // itself — the window would open invisible.
      const proc = spawn(cmd, args);
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
      proc.on("close", (code) => done(anyExit || code === 0));
    } catch {
      resolve(false);
    }
  });
}

const LINUX_OPEN: [string, string[]][] = [
  ["xdg-open", []],
  ["gio", ["open"]],
];

// Open `dir` in the platform file manager. Never throws; false means the
// caller should tell the user it didn't work.
export async function openFolder(dir: string): Promise<boolean> {
  // Check the path ourselves first: explorer.exe silently opens Documents for a
  // path that doesn't exist, which would look like success.
  if (!dir || !existsSync(dir)) return false;
  if (process.platform === "win32") {
    // explorer.exe exits 1 even when the window opens fine, so any clean exit
    // counts; only a failure to spawn (or a hang) is a real error.
    return launch("explorer", [dir], true);
  }
  if (process.platform === "darwin") {
    return launch("open", [dir]);
  }
  for (const [cmd, args] of LINUX_OPEN) {
    if (await launch(cmd, [...args, dir])) return true;
  }
  return false;
}
