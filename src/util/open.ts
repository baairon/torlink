import { spawn } from "node:child_process";

/**
 * Opens a file or directory path using the OS default application handler.
 * Returns a promise resolving to true if opened successfully, otherwise false.
 */
export function openPath(targetPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      let proc;
      if (process.platform === "darwin") {
        proc = spawn("open", [targetPath], { windowsHide: true });
      } else if (process.platform === "win32") {
        // Safety check: prevent command injection/shell breakout via double quotes in paths
        if (targetPath.includes('"')) {
          resolve(false);
          return;
        }
        // cmd.exe /c start "" <path>
        // Note: The empty string "" is required because if the targetPath contains spaces
        // and is quoted, the start command will otherwise treat it as the window title.
        proc = spawn("cmd.exe", ["/c", "start", "", targetPath], { windowsHide: true });
      } else {
        // Linux and other Unix-like systems
        proc = spawn("xdg-open", [targetPath], { windowsHide: true });
      }

      proc.on("error", () => resolve(false));
      proc.on("close", (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}
