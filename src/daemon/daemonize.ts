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

export interface RunDescriptor {
  name: string;
  pid: number;
  argv: string[]; // args to node (script path + subcommand + flags)
  cwd: string;
  startedAt: number;
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
  child.unref();
  const pid = child.pid ?? 0;
  if (pid) {
    fs.writeFileSync(pidPathFor(name), `${pid}\n`);
    const desc: RunDescriptor = { name, pid, argv, cwd, startedAt: Date.now() };
    fs.writeFileSync(runPathFor(name), `${JSON.stringify(desc, null, 2)}\n`);
  }
  return pid;
}

// In the parent: fork a detached child and exit. In the already-detached child
// (marker set): return so the caller keeps running normally.
export function daemonize(name: string): void {
  if (process.env[MARKER] === "1") return;

  const pid = spawnDaemon(name, process.argv.slice(1), process.cwd());
  const logPath = logPathFor(name);
  const pidPath = pidPathFor(name);

  console.log(`torlink ${name} daemon started (pid ${pid}).`);
  console.log(`  logs: ${logPath}`);
  console.log(`  stop: kill ${pid}   (or: kill $(cat ${pidPath}))`);
  process.exit(0);
}
