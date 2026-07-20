// Self-backgrounding for the headless commands: `--daemon` re-spawns this exact
// command detached from the terminal (own session, stdio to a log file), writes
// a pidfile plus a run descriptor, and exits the parent. You can then log out and
// it keeps running.
//
// The run descriptor is what lets `torlnk update` relaunch a daemon on its exact
// original command after rebuilding.
//
// NOTE: on a box with systemd, a `systemctl --user` service with linger is a
// sturdier way to run these (auto-restart, boot-start). This is the no-systemd
// convenience path.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logsDir } from "../config/paths";

const MARKER = "TORLINK_DAEMONIZED";

export function logPathFor(name: string): string {
  return path.join(logsDir, `${name}.log`);
}
export function pidPathFor(name: string): string {
  return path.join(logsDir, `${name}.pid`);
}
export function runPathFor(name: string): string {
  return path.join(logsDir, `${name}.run.json`);
}
export function lockPathFor(name: string): string {
  return path.join(logsDir, `${name}.lock`);
}

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

// Single-instance guard for the headless modes: two processes running the same
// subcommand share the state dir and clobber each other's queue/seeds/history
// files last-writer-wins (two `serve` daemons also fight over the API port),
// so only one may run per subcommand. The lock is a pid-stamped file held for
// the process lifetime; a stale lock whose pid is gone is taken over.
export function acquireInstanceLock(name: string): boolean {
  const file = lockPathFor(name);
  fs.mkdirSync(logsDir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, `${process.pid}\n`, { flag: "wx" });
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") return false;
      let pid = 0;
      try {
        pid = Number(fs.readFileSync(file, "utf8").trim());
      } catch {}
      if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) return false;
      // Stale lock: its owner died without releasing. Take it over.
      try {
        fs.rmSync(file, { force: true });
      } catch {}
    }
  }
  return false;
}

export function releaseInstanceLock(name: string): void {
  try {
    // Only release our own lock — never one a replacement process took over.
    const raw = fs.readFileSync(lockPathFor(name), "utf8").trim();
    if (Number(raw) === process.pid) fs.rmSync(lockPathFor(name), { force: true });
  } catch {}
}

// Records argv and cwd only, not env: a daemon relaunched after an update
// inherits the updater's environment, so env-dependent behavior (proxies,
// TORLINK_* overrides) follows the shell that ran `torlnk update`.
export interface RunDescriptor {
  name: string;
  pid: number;
  argv: string[]; // args to node (script path + subcommand + flags)
  cwd: string;
  startedAt: number;
}

// Secrets must not sit in the run descriptor: it lives unencrypted in the logs
// dir and the token is also visible in `ps`. A relaunched daemon picks the
// token up from TORLINK_API_TOKEN / TORLINK_FILES_TOKEN instead, so token-guarded
// public daemons should set the env var for unattended restarts.
export function redactArgv(argv: string[]): string[] {
  return argv.map((arg, i) => {
    if (i > 0 && argv[i - 1] === "--token") return "***";
    if (arg.startsWith("--token=")) return "--token=***";
    return arg;
  });
}

// Remove a daemon's pidfile + run descriptor. With expectedPid, removal only
// happens when the descriptor points at that process — so a foreground run's
// shutdown hook never deletes the records of a detached daemon that happens to
// share its subcommand name.
export function removeRunDescriptor(name: string, expectedPid?: number): void {
  const runPath = runPathFor(name);
  try {
    if (expectedPid !== undefined) {
      const raw = JSON.parse(fs.readFileSync(runPath, "utf8")) as { pid?: unknown };
      if (raw.pid !== expectedPid) return;
    }
    fs.rmSync(pidPathFor(name), { force: true });
    fs.rmSync(runPath, { force: true });
  } catch {}
}

// Spawn `node <argv>` detached with its own session and stdio pointed at the log,
// then record the pid and enough to relaunch it later. Shared by the initial
// --daemon fork and by a post-update restart, so both write the pidfile and
// descriptor the same way.
export function spawnDaemon(name: string, argv: string[], cwd: string): number {
  fs.mkdirSync(logsDir, { recursive: true });
  const out = fs.openSync(logPathFor(name), "a");
  const child = spawn(process.execPath, argv, {
    cwd,
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, [MARKER]: "1" },
  });
  // The child holds its own dup of the log fd; the parent's copy would leak.
  try {
    fs.closeSync(out);
  } catch {}
  // A failed spawn fires "error" asynchronously; with no listener it would
  // crash the caller. child.pid stays undefined either way, handled below.
  child.on("error", () => {});
  child.unref();
  const pid = child.pid ?? 0;
  if (pid) {
    fs.writeFileSync(pidPathFor(name), `${pid}\n`);
    const desc: RunDescriptor = { name, pid, argv: redactArgv(argv), cwd, startedAt: Date.now() };
    fs.writeFileSync(runPathFor(name), `${JSON.stringify(desc, null, 2)}\n`);
  }
  return pid;
}

// In the parent: fork a detached child and exit. In the already-detached child
// (marker set): return so the caller keeps running normally.
export function daemonize(name: string): void {
  if (process.env[MARKER] === "1") return;

  const pid = spawnDaemon(name, process.argv.slice(1), process.cwd());
  if (!pid) {
    console.error(`error: failed to start the ${name} daemon; nothing was backgrounded.`);
    process.exit(1);
  }
  const logPath = logPathFor(name);

  console.log(`torlink ${name} daemon started (pid ${pid}).`);
  console.log(`  logs: ${logPath}`);
  if (process.platform === "win32") {
    console.log(`  stop: Stop-Process -Id ${pid}`);
  } else {
    console.log(`  stop: kill ${pid}   (or: kill $(cat ${pidPathFor(name)}))`);
  }
  process.exit(0);
}
