import { spawn } from "node:child_process";

// A media player outlives its launch, so — unlike openFolder — spawn detached
// and never kill it on a timer. Success means it didn't fail to spawn (ENOENT)
// or exit non-zero within the grace window.
function launch(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(cmd, args, { stdio: "ignore", detached: true });
      let settled = false;
      const done = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      // Still alive after the grace window: unref so playback survives quit.
      const timer = setTimeout(() => {
        proc.unref();
        done(true);
      }, 400);
      timer.unref?.();
      proc.on("error", () => done(false));
      proc.on("exit", (code) => done(code === 0));
    } catch {
      resolve(false);
    }
  });
}

// e.g. TORLINK_MEDIA_PLAYER="mpv --fullscreen"; the URL is appended last.
function customPlayer(): string[] | null {
  const raw = process.env.TORLINK_MEDIA_PLAYER?.trim();
  if (!raw) return null;
  const parts = raw.split(/\s+/);
  return parts.length > 0 && parts[0] ? parts : null;
}

// Tried in order; mpv/vlc first, the OS URL handler last. Windows `start` needs
// an empty title argument before the URL.
function candidates(): [string, string[]][] {
  if (process.platform === "darwin") {
    return [["mpv", []], ["open", ["-a", "VLC"]], ["open", []]];
  }
  if (process.platform === "win32") {
    return [["mpv", []], ["vlc", []], ["cmd", ["/c", "start", ""]]];
  }
  return [["mpv", []], ["vlc", []], ["xdg-open", []]];
}

// Open `url` in a media player. Never throws; false means nothing could be
// launched and the caller should tell the user.
export async function playMedia(url: string): Promise<boolean> {
  if (!url) return false;
  const custom = customPlayer();
  if (custom) {
    const [cmd, ...rest] = custom;
    return launch(cmd as string, [...rest, url]);
  }
  for (const [cmd, args] of candidates()) {
    if (await launch(cmd, [...args, url])) return true;
  }
  return false;
}
