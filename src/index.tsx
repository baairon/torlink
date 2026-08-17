import { render } from "ink";
import { parseCliArgs, HELP_TEXT } from "./cli/args";
import { daemonize } from "./daemon/daemonize";
import { runAttach } from "./daemon/attach";
import { containUnhandledRejections, logCrash } from "./util/crashlog";
import { deleteIssued } from "./meta/kittyGraphics";
import { VERSION } from "./version";
import { App } from "./ui/App";
import { getGraphicsTier, probeGraphics, setGraphicsTier } from "./ui/graphics";

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

// An unhandled promise rejection must never take the whole app down: webtorrent
// can produce one from inside its own async internals where no caller's
// try/catch or error event can reach (see util/crashlog.ts). Contained and
// logged for every mode; headless runs also echo one line to their log.
containUnhandledRejections({
  echo:
    cmd.kind === "update" ||
    cmd.kind === "search" ||
    cmd.kind === "watch" ||
    cmd.kind === "seed" ||
    cmd.kind === "serve" ||
    cmd.kind === "files",
});

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
} else if (cmd.kind === "seed") {
  if (cmd.daemon) daemonize("seed");
  const { path: target, seedTimeMs, deleteFiles } = cmd;
  void import("./daemon/seed")
    .then(({ runSeed }) => runSeed(target, { seedTimeMs, deleteFiles }))
    .then(() => process.exit(0))
    .catch(failHeadless);
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
  void import("./daemon/serve")
    .then(({ runServe }) => runServe(options))
    .then(() => process.exit(0))
    .catch(failHeadless);
} else if (cmd.kind === "files") {
  if (cmd.daemon) daemonize("files");
  const options = {
    port: cmd.port,
    host: cmd.host,
    token: cmd.token ?? process.env.TORLINK_FILES_TOKEN,
    dir: cmd.dir,
  };
  void import("./daemon/files").then(({ runFiles }) => runFiles(options).catch(failHeadless));
} else if (cmd.kind === "search") {
  // One JSON document on stdout, then exit: the shape a script can pipe into
  // jq. Exit 1 only when every source failed, so an empty-but-healthy search
  // is still a success.
  void import("./cli/search")
    .then(({ runSearch }) => runSearch({ query: cmd.query, category: cmd.category }))
    .then(({ document, exitCode }) => {
      process.exitCode = exitCode;
      process.stdout.write(`${JSON.stringify(document)}\n`);
    })
    .catch(failHeadless);
} else {

// Enter the alt-screen and hide the hardware cursor: the TUI draws its own
// cursor (the search field block, list pointers), so the terminal's should
// stay hidden. restoreTerminal shows it again on exit.
process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[22;0t\x1b]0;torlink\x07");
if (process.platform === "win32") process.title = "torlink";

// Which picture tier the terminal gets. Asked once, here, because the answer costs a round trip
// with the terminal and must be settled before anything renders; steps 1-4 of the probe make this
// a resolved microtask on every terminal that is not a candidate, which is nearly all of them.
setGraphicsTier(
  await probeGraphics({ stdin: process.stdin, stdout: process.stdout, env: process.env }),
);

let restored = false;
function restoreTerminal(): void {
  if (restored) return;
  restored = true;
  // Alt-screen restore goes out first, deletes second. Node's write to a TTY is synchronous on
  // POSIX but not on Windows, and deleteIssued() can be large on a long session (~28 bytes per
  // distinct poster) — a write that truncates on process exit must not be able to take the
  // trailing escapes with it and strand the user in the alt screen. `d=I` frees an image by id
  // regardless of which screen is active, so losing the tail here only leaves some images in the
  // terminal's store, which is cheap and invisible.
  process.stdout.write("\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[23;0t\x1b[?1049l");
  // Images outlive the alt screen: the terminal keeps them in a store keyed by id until something
  // deletes them, so leaving without this would grow that store for the life of the terminal. Only
  // the ids this process handed out — the store is shared with whatever else drew in this window.
  if (getGraphicsTier() === "kitty") process.stdout.write(deleteIssued());
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
  logCrash("uncaughtException", err);
  restoreTerminal();
  console.error(err);
  process.exit(1);
});

}
