import { render } from "ink";
import { parseCliArgs, HELP_TEXT } from "./cli/args";
import { daemonize } from "./daemon/daemonize";
import { runAttach } from "./daemon/attach";
import { VERSION } from "./version";
import { App } from "./ui/App";

const cmd = parseCliArgs(process.argv.slice(2));

if (cmd.kind === "help") {
  console.log(HELP_TEXT);
  process.exit(0);
}

if (cmd.kind === "version") {
  console.log(`torlink v${VERSION}`);
  process.exit(0);
}

if (cmd.kind === "invalid") {
  console.error(`error: unknown argument '${cmd.arg}'\n`);
  console.error(HELP_TEXT);
  process.exit(1);
}

// Run/reattach the TUI inside a persistent tmux session (execs tmux, then exits).
if (cmd.kind === "attach") {
  runAttach();
}

// Headless subcommands: run the download queue with no terminal UI (for
// seedboxes and servers). Kept above the alt-screen setup below — these paths
// never touch the TUI. Each is dynamically imported so a plain `torlnk` launch
// pays nothing for them.
function failHeadless(err: unknown): never {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

if (cmd.kind === "update") {
  void import("./update/run").then(({ runUpdate }) => runUpdate({ force: cmd.force }).catch(failHeadless));
} else if (cmd.kind === "watch") {
  if (cmd.daemon) daemonize("watch"); // parent exits here; the detached child continues
  const { dir, downloadDir, seedTimeMs, deleteFiles } = cmd;
  void import("./daemon/watch").then(({ runWatch }) =>
    runWatch(dir, downloadDir, { seedTimeMs, deleteFiles }).catch(failHeadless),
  );
} else if (cmd.kind === "serve") {
  if (cmd.daemon) daemonize("serve");
  const options = {
    port: cmd.port,
    host: cmd.host,
    token: cmd.token ?? process.env.TORLINK_API_TOKEN,
    downloadDir: cmd.downloadDir,
    seedTimeMs: cmd.seedTimeMs,
    deleteFiles: cmd.deleteFiles,
  };
  void import("./daemon/serve").then(({ runServe }) => runServe(options).catch(failHeadless));
} else if (cmd.kind === "files") {
  if (cmd.daemon) daemonize("files");
  const options = {
    port: cmd.port,
    host: cmd.host,
    token: cmd.token ?? process.env.TORLINK_FILES_TOKEN,
    dir: cmd.dir,
  };
  void import("./daemon/files").then(({ runFiles }) => runFiles(options).catch(failHeadless));
} else {

// Enter the alt-screen and hide the hardware cursor: the TUI draws its own
// cursor (the search field block, list pointers), so the terminal's should
// stay hidden. restoreTerminal shows it again on exit.
process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[22;0t\x1b]0;torlink\x07");
if (process.platform === "win32") process.title = "torlink";

let restored = false;
function restoreTerminal(): void {
  if (restored) return;
  restored = true;
  process.stdout.write("\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[23;0t\x1b[?1049l");
}

let exiting = false;
function forceExit(code = 0): void {
  // Re-entry (e.g. ctrl-c after q): never get stuck, just leave now.
  if (exiting) {
    restoreTerminal();
    process.exit(code);
  }
  exiting = true;
  // Exit synchronously and unconditionally. State is already flushed
  // (quitAll -> persistSync, and the unmount effect runs suspend()), so we never
  // wait on webtorrent releasing its sockets; the OS reclaims them. Unmount
  // first to restore raw mode, then our own terminal sequences, then go.
  try {
    app?.unmount();
  } catch {}
  restoreTerminal();
  process.exit(code);
}

const app = render(
  <App
    initialMagnet={cmd.initialMagnet}
    initialTorrent={cmd.initialTorrent}
    onQuit={() => forceExit(0)}
  />,
  { exitOnCtrlC: false },
);

app
  .waitUntilExit()
  .then(() => forceExit(0))
  .catch((err) => {
    restoreTerminal();
    console.error(err);
    process.exit(1);
  });

process.on("SIGINT", () => forceExit(0));
process.on("SIGTERM", () => forceExit(0));
process.on("exit", restoreTerminal);

process.on("uncaughtException", (err) => {
  restoreTerminal();
  console.error(err);
  process.exit(1);
});

}
