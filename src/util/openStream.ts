import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";

function launchDetached(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(cmd, args, {
        detached: true,
        stdio: "ignore",
      });
      proc.unref();

      let settled = false;
      proc.on("error", () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      });

      // If the process survives for 500ms without an ENOENT error, assume it launched.
      setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(true);
        }
      }, 500);
    } catch {
      resolve(false);
    }
  });
}

const LINUX_PLAYERS: [string, string[]][] = [
  ["vlc", []],
  ["mpv", []],
  ["xdg-open", []],
];

export async function openStream(url: string): Promise<boolean> {
  if (!url) return false;
  
  let playlistPath: string | null = null;
  try {
    playlistPath = join(tmpdir(), `torlink_stream_${randomBytes(4).toString("hex")}.m3u`);
    writeFileSync(playlistPath, `#EXTM3U\n${url}\n`, "utf8");
  } catch (e) {
    // Ignore if we can't create the playlist
  }

  const targetUrl = playlistPath || url;

  if (process.platform === "win32") {
    if (await launchDetached("vlc", [targetUrl])) return true;
    
    // Check common VLC installation paths if it's not in PATH
    const vlcPaths = [
      "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",
      "C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe"
    ];
    for (const vlcPath of vlcPaths) {
      if (existsSync(vlcPath)) {
        if (await launchDetached(vlcPath, [targetUrl])) return true;
      }
    }

    if (await launchDetached("mpv", [targetUrl])) return true;
    
    // Fallback to explorer, which will open the default media player for the .m3u file
    return launchDetached("explorer", [targetUrl]);
  }
  
  if (process.platform === "darwin") {
    if (await launchDetached("vlc", [targetUrl])) return true;
    if (await launchDetached("mpv", [targetUrl])) return true;
    return launchDetached("open", [targetUrl]);
  }
  
  for (const [cmd, args] of LINUX_PLAYERS) {
    if (await launchDetached(cmd, [...args, targetUrl])) return true;
  }
  return false;
}
