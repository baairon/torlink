// Restart the --daemon processes after an update. We only know about daemons that
// went through daemonize (they leave a run descriptor next to their log); a
// systemd unit or a foreground run manages its own lifecycle and is left alone.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logsDir } from "../config/paths";
import {
  isAlive,
  removeRunDescriptor,
  runPathFor,
  spawnDaemon,
  type RunDescriptor,
} from "./daemonize";

export { isAlive } from "./daemonize";

// Best-effort process start time (epoch ms). Used to confirm the pid recorded
// in a run descriptor still belongs to the daemon it described: after an
// unclean daemon death the OS can recycle the pid, and a bare kill(pid, 0)
// would then SIGTERM an unrelated process. Returns null when the platform
// gives no answer (caller treats that as unverifiable).
export function processStartTime(pid: number): number | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === "linux") {
      // /proc/<pid>/stat field 22 (starttime, clock ticks since boot) + the
      // btime line of /proc/stat. comm is dropped first since it may contain
      // spaces/parens; CLK_TCK is 100 on every mainstream Linux.
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const rest = stat.slice(stat.lastIndexOf(")") + 2);
      const startTicks = Number(rest.split(" ")[19]);
      const btime = /^btime (\d+)$/m.exec(fs.readFileSync("/proc/stat", "utf8"));
      if (!Number.isFinite(startTicks) || !btime) return null;
      return Number(btime[1]) * 1000 + startTicks * 10;
    }
    if (process.platform === "win32") {
      const out = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString("o")`,
        ],
        { encoding: "utf8", windowsHide: true, timeout: 5000 },
      );
      const t = Date.parse((out.stdout ?? "").trim());
      return Number.isNaN(t) ? null : t;
    }
    // macOS and other POSIX with ps(1).
    const out = spawnSync("ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8",
      timeout: 5000,
    });
    const t = Date.parse((out.stdout ?? "").trim());
    return Number.isNaN(t) ? null : t;
  } catch {
    return null;
  }
}

// True when the process currently owning desc.pid plausibly IS the daemon the
// descriptor recorded. The daemon starts a moment before its descriptor is
// written; a process handed the recycled pid starts after the daemon died —
// i.e. after startedAt — so a start time past the window means "stranger".
export function sameRecordedProcess(
  desc: RunDescriptor,
  startTimeImpl: (pid: number) => number | null = processStartTime,
): boolean {
  if (!desc.startedAt || desc.startedAt <= 0) return false;
  const started = startTimeImpl(desc.pid);
  if (started === null) return false;
  return started >= desc.startedAt - 120_000 && started <= desc.startedAt + 5_000;
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
    sameProcessImpl?: (desc: RunDescriptor) => boolean;
    killImpl?: (pid: number, signal: NodeJS.Signals) => void;
    spawnImpl?: (name: string, argv: string[], cwd: string) => number;
  } = {},
): Promise<RestartResult> {
  const sleep = opts.sleep ?? realSleep;
  const waitMs = opts.waitMs ?? 100;
  const graceMs = opts.graceMs ?? 10_000;
  const alive = opts.isAliveImpl ?? isAlive;
  const sameProcess = opts.sameProcessImpl ?? sameRecordedProcess;
  const kill = opts.killImpl ?? ((pid, signal) => process.kill(pid, signal));
  const spawnFn = opts.spawnImpl ?? spawnDaemon;
  if (!alive(desc.pid)) {
    // Dead daemon: prune the stale record so the next update doesn't re-check it.
    removeRunDescriptor(desc.name);
    return { newPid: null, stillRunning: false };
  }
  if (!sameProcess(desc)) {
    // The recorded daemon is gone and its pid now belongs to a stranger we
    // must not signal. Drop the stale record and leave that process alone.
    removeRunDescriptor(desc.name);
    return { newPid: null, stillRunning: false };
  }

  try {
    kill(desc.pid, "SIGTERM");
  } catch {
    // Already gone between the check and the signal; fine, we'll re-spawn.
  }
  for (let waited = 0; waited < graceMs && alive(desc.pid); waited += waitMs) await sleep(waitMs);
  if (alive(desc.pid)) return { newPid: null, stillRunning: true };

  return { newPid: spawnFn(desc.name, desc.argv, desc.cwd), stillRunning: false };
}
