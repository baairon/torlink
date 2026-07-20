import { spawn } from "node:child_process";

function launch(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
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
      proc.on("close", (code) => done(code === 0));
    } catch {
      resolve(false);
    }
  });
}

const LINUX_OPEN: [string, string[]][] = [
  ["xdg-open", []],
  ["gio", ["open"]],
];

// Open a magnet URI in the system's default torrent client. Never throws;
// false means the caller should tell the user it didn't work.
export async function openMagnet(magnet: string): Promise<boolean> {
  if (!magnet || !magnet.startsWith("magnet:?")) return false;
  
  if (process.platform === "win32") {
    // On Windows, just pass the magnet URI directly - registered handlers will deal with it
    return launch("start", [magnet]);
  }
  if (process.platform === "darwin") {
    return launch("open", [magnet]);
  }
  for (const [cmd, args] of LINUX_OPEN) {
    if (await launch(cmd, [...args, magnet])) return true;
  }
  return false;
}
