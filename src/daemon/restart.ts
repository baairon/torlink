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

export interface RestartResult {
  newPid: number | null; // pid of the relaunched daemon, when one was spawned
  stillRunning: boolean; // the old process outlived the grace; nothing spawned
}

// Stop a running daemon and start it again from its recorded command so it comes
// back on the freshly built code. Waits for the old process to exit first, and
// if it outlives the grace (tearing down a client that seeds many torrents can
// take a while) reports stillRunning instead of spawning: two daemons must never
// contend for the same ports and state files.
export async function restartDaemon(
  desc: RunDescriptor,
  opts: {
    sleep?: (ms: number) => Promise<void>;
    waitMs?: number;
    graceMs?: number;
    isAliveImpl?: (pid: number) => boolean;
    killImpl?: (pid: number, signal: NodeJS.Signals) => void;
    spawnImpl?: (name: string, argv: string[], cwd: string) => number;
  } = {},
): Promise<RestartResult> {
  const sleep = opts.sleep ?? realSleep;
  const waitMs = opts.waitMs ?? 100;
  const graceMs = opts.graceMs ?? 10_000;
  const alive = opts.isAliveImpl ?? isAlive;
  const kill = opts.killImpl ?? ((pid, signal) => process.kill(pid, signal));
  const spawnFn = opts.spawnImpl ?? spawnDaemon;
  if (!alive(desc.pid)) return { newPid: null, stillRunning: false };

  try {
    kill(desc.pid, "SIGTERM");
  } catch {
    // Already gone between the check and the signal; fine, we'll re-spawn.
  }
  for (let waited = 0; waited < graceMs && alive(desc.pid); waited += waitMs) await sleep(waitMs);
  if (alive(desc.pid)) return { newPid: null, stillRunning: true };

  return { newPid: spawnFn(desc.name, desc.argv, desc.cwd), stillRunning: false };
}
