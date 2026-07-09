// Detach / reattach for the TUI, the simple + stable way: run torlink inside a
// persistent tmux session. `torlnk attach` creates the session (or reattaches to
// it if it's already running), so you can detach with tmux's ctrl-b d, log out,
// log back in over ssh/mosh, and `torlnk attach` again to pick up right where
// you left off. tmux does the heavy lifting, so this stays tiny.

import { spawnSync } from "node:child_process";

export const SESSION = "torlink";

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function hasTmux(): boolean {
  try {
    return spawnSync("tmux", ["-V"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

// The shell command tmux should run inside the session: this same executable,
// no args, i.e. the plain TUI. tmux runs it via `sh -c`, so sh-quoting is right.
export function tuiCommand(execPath: string, scriptPath: string): string {
  return `${shQuote(execPath)} ${shQuote(scriptPath)}`;
}

export function runAttach(): never {
  if (!hasTmux()) {
    console.error(
      "torlink attach needs tmux (for detach/reattach). Install tmux, or just run `torlnk`.",
    );
    process.exit(1);
  }
  const inner = tuiCommand(process.execPath, process.argv[1] ?? "");
  // -A: attach if the session exists, otherwise create it and run the TUI.
  const r = spawnSync("tmux", ["new-session", "-A", "-s", SESSION, inner], { stdio: "inherit" });
  process.exit(r.status ?? 0);
}
