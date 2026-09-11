import { spawn } from "node:child_process";

function launch(cmd: string, args: string[], anyExit = false): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(cmd, args);
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          proc.kill();
        } catch {}
        resolve(false);
      }, 4000);
      timer.unref?.();
      const done = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      proc.on("error", () => done(false));
      proc.on("close", (code) => done(anyExit || code === 0));
    } catch {
      resolve(false);
    }
  });
}

// ponytail: reuse the platform-opener pattern from openFolder for URLs.
export async function openUrl(url: string): Promise<boolean> {
  if (!url) return false;
  if (process.platform === "win32") return launch("cmd", ["/c", "start", "", url], true);
  if (process.platform === "darwin") return launch("open", [url]);
  return (await launch("xdg-open", [url])) || (await launch("gio", ["open", url]));
}
