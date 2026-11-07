import { render } from "ink";
import { parseCliArgs, HELP_TEXT } from "./cli/args";
import { daemonize } from "./daemon/daemonize";
import { runAttach } from "./daemon/attach";
import { containUnhandledRejections, logCrash } from "./util/crashlog";
import { armInterface, exportNetworkEnv } from "./download/network";
import { bindAddress, interfaceNames } from "./util/bind";
import { VERSION } from "./version";
import { App } from "./ui/App";
import { installOverlay, sixelSupported } from "./ui/overlay";

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

// --interface / --peer-port / --dht-port ride on the environment from here,
// the way TORLINK_NO_UTP does: the TUI's own boot, a --daemon child and the
// search command all read it there, and a restart after `torlnk update`
// replays argv, so the flags survive where the environment would not. The
// bind is armed now, before any mode can open a socket (#164).
if ("network" in cmd && cmd.network) exportNetworkEnv(cmd.network);
if (process.env.TORLINK_INTERFACE) armInterface(process.env.TORLINK_INTERFACE);

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
//
// Every long-running mode resolves from its SIGINT/SIGTERM handler once the
// synchronous state flush (queue.suspend) is done, and the CLI exits right
// there. It must never wait for the event loop to drain: that would mean
// waiting on webtorrent's teardown, which a single peer connection it has lost
// track of keeps from ever finishing, and the process then outlives its
// supervisor's stop forever (#207). State is already on disk, and the OS
// reclaims the sockets, the same bargain engine.destroy() and the TUI's
// forceExit make.
function failHeadless(err: unknown): never {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

if (cmd.kind === "update") {
  void import("./update/run").then(({ runUpdate }) => runUpdate({ force: cmd.force }).catch(failHeadless));
} else if (cmd.kind === "watch") {
  if (cmd.daemon) daemonize("watch"); // parent exits here; the detached child continues
  const { dir, downloadDir, seedTimeMs, deleteFiles, playlist } = cmd;
  void import("./daemon/watch")
    .then(({ runWatch }) => runWatch(dir, downloadDir, { seedTimeMs, deleteFiles, playlist }))
    .then(() => process.exit(0))
    .catch(failHeadless);
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
    playlist: cmd.playlist,
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
  void import("./daemon/files")
    .then(({ runFiles }) => runFiles(options))
    .then(() => process.exit(0))
    .catch(failHeadless);
} else if (cmd.kind === "search") {
  // A bound search with its interface down would only report every source as
  // unreachable; say why instead.
  const iface = process.env.TORLINK_INTERFACE;
  if (iface && bindAddress() === null) {
    failHeadless(new Error(`interface ${iface} is down (interfaces: ${interfaceNames().join(", ")})`));
  }
  // One JSON document on stdout, then exit: the shape a script can pipe into
  // jq. Exit 1 only when every source failed, so an empty-but-healthy search
  // is still a success.
  void import("./cli/search")
    .then(({ runSearch }) =>
      runSearch({ query: cmd.query, category: cmd.category, timeoutMs: cmd.timeoutMs }),
    )
    .then(({ document, exitCode }) => {
      // Leave once the document is flushed instead of when the event loop
      // empties. A source cut off at the deadline leaves work behind that
      // nothing can cancel (a connect or a DNS lookup still in flight), and
      // the caller's pipe would stay open until that gave up on its own.
      process.stdout.write(`${JSON.stringify(document)}\n`, () => process.exit(exitCode));
    })
    .catch(failHeadless);
} else {

// Enter the alt-screen and hide the hardware cursor: the TUI draws its own
// cursor (the search field block, list pointers), so the terminal's should
// stay hidden. restoreTerminal shows it again on exit.
process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[22;0t\x1b]0;torlink\x07");
// Game covers as real images where the terminal draws Sixel; text blocks otherwise.
if (sixelSupported()) installOverlay(process.stdout);
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
    playlist={cmd.playlist}
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
