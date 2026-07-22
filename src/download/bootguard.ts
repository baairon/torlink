import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bootMarkerFile } from "../config/paths";

// Crash-boot breaker for the restore path. A marker file is armed just before
// persisted state is handed to the torrent engine and disarmed once the boot
// has stayed alive long enough to be called healthy (or the app flushes state
// on a clean exit, see DownloadQueue.persistSync). Finding a marker at the
// next boot therefore means the previous one died while restoring: something
// in the saved state detonates the engine, and a dependency drifting under
// webtorrent can turn a perfectly valid magnet into an uncatchable async
// throw (the Jul-2026 uint8-util incident, see deps-pin.test.ts). That boot
// restores everything as paused and starts no engines, so the UI always comes
// up and the user resumes items on their own terms.

// How long after restore the process must survive before the marker is
// disarmed. Long enough for the engine's async startup (parse, discovery,
// store init) to have blown up if it was going to.
export const BOOT_SETTLE_MS = 4000;

export function wasBootInterrupted(): boolean {
  try {
    return existsSync(bootMarkerFile);
  } catch {
    return false;
  }
}

export function armBootMarker(): void {
  try {
    mkdirSync(path.dirname(bootMarkerFile), { recursive: true });
    writeFileSync(bootMarkerFile, JSON.stringify({ at: Date.now(), pid: process.pid }));
  } catch {
    // Failing to write the marker never blocks a boot.
  }
}

export function disarmBootMarker(): void {
  try {
    rmSync(bootMarkerFile, { force: true });
  } catch {}
}
