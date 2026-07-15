// Restart the --daemon processes after an update. We only know about daemons that
// went through daemonize (they leave a run descriptor next to their log); a
// systemd unit or a foreground run manages its own lifecycle and is left alone.

import fs from "node:fs";
import path from "node:path";
import { logsDir } from "../config/paths";
import { runPathFor, spawnDaemon, type RunDescriptor } from "./daemonize";

// `kill -0` only checks whether we may signal the pid. ESRCH means it's gone;
// EPERM means it's alive but owned by someone else, so still alive.
export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readDescriptor(file: string): RunDescriptor | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<RunDescriptor>;
    if (
      typeof raw.name === "string" &&
      typeof raw.pid === "number" &&
      Array.isArray(raw.argv) &&
      typeof raw.cwd === "string"
    ) {
      return {
        name: raw.name,
        pid: raw.pid,
        argv: raw.argv.filter((a): a is string => typeof a === "string"),
        cwd: raw.cwd,
        startedAt: typeof raw.startedAt === "number" ? raw.startedAt : 0,
      };
    }
  } catch {
    // A partial/corrupt descriptor just means we can't restart that one.
  }
  return null;
}

export function listRunDescriptors(dir: string = logsDir): RunDescriptor[] {
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: RunDescriptor[] = [];
  for (const file of files) {
    if (!file.endsWith(".run.json")) continue;
    const desc = readDescriptor(path.join(dir, file));
    if (desc) out.push(desc);
  }
  return out;
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Stop a running daemon and start it again from its recorded command so it comes
// back on the freshly built code. Returns the new pid, or null if it wasn't
// running (nothing to restart). Waits for the old process to exit first so the
// two never fight over the same state files.
export async function restartDaemon(
  desc: RunDescriptor,
  opts: { sleep?: (ms: number) => Promise<void>; waitMs?: number } = {},
): Promise<number | null> {
  const sleep = opts.sleep ?? realSleep;
  const waitMs = opts.waitMs ?? 100;
  if (!isAlive(desc.pid)) return null;

  try {
    process.kill(desc.pid, "SIGTERM");
  } catch {
    // Already gone between the check and the signal; fine, we'll re-spawn.
  }
  for (let i = 0; i < 20 && isAlive(desc.pid); i++) await sleep(waitMs);

  return spawnDaemon(desc.name, desc.argv, desc.cwd);
}
