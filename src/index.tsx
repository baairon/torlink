import { render } from "ink";
import { parseCliArgs, HELP_TEXT } from "./cli/args";
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

// Headless subcommand: run the download queue with no terminal UI (for seedboxes
// and servers). Kept above the alt-screen setup below — this path never touches
// the TUI. Loaded dynamically so a plain `torlnk` launch pays nothing for it.
if (cmd.kind === "watch") {
  const dir = cmd.dir;
  const downloadDir = cmd.downloadDir;
  void import("./daemon/watch").then(({ runWatch }) =>
    runWatch(dir, downloadDir).catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }),
  );
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
