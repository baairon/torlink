// Self-backgrounding for the headless commands: `--daemon` re-spawns this exact
// command detached from the terminal (own session, stdio to a log file), writes
// a pidfile, and exits the parent. You can then log out and it keeps running.
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

// In the parent: fork a detached child and exit. In the already-detached child
// (marker set): return so the caller keeps running normally.
export function daemonize(name: string): void {
  if (process.env[MARKER] === "1") return;

  fs.mkdirSync(logsDir, { recursive: true });
  const logPath = logPathFor(name);
  const pidPath = pidPathFor(name);
  const out = fs.openSync(logPath, "a");

  const child = spawn(process.execPath, process.argv.slice(1), {
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, [MARKER]: "1" },
  });
  child.unref();
  if (child.pid) fs.writeFileSync(pidPath, `${child.pid}\n`);

  console.log(`torlink ${name} daemon started (pid ${child.pid}).`);
  console.log(`  logs: ${logPath}`);
  console.log(`  stop: kill ${child.pid}   (or: kill $(cat ${pidPath}))`);
  process.exit(0);
}
