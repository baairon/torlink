import "./bootstrap-terminal-env";
import { render } from "ink";
import { loadEnv } from "../config/env";
import { parseCliArgs, HELP_TEXT } from "../cli/args";
import { VERSION } from "../constants/version";
import { App } from "../ui/App";
import { runServe } from "../server/runServe";

loadEnv();

const cmd = parseCliArgs(process.argv.slice(2));

if (cmd.kind === "help") {
  console.log(HELP_TEXT);
  process.exit(0);
}

if (cmd.kind === "version") {
  console.log(`TorZlink v${VERSION}`);
  process.exit(0);
}

if (cmd.kind === "invalid") {
  console.error(`error: unknown argument '${cmd.arg}'\n`);
  console.error(HELP_TEXT);
  process.exit(1);
}

if (cmd.kind === "serve") {
  runServe({ host: cmd.host, port: cmd.port }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  startTui(cmd);
}

function startTui(cmd: Extract<ReturnType<typeof parseCliArgs>, { kind: "run" }>): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(
      "\nTorZlink needs an interactive terminal (TTY).\n\n" +
        "Web UI (no TTY):\n" +
        "  torzlink serve --host 0.0.0.0 --port 8787\n\n" +
        "Docker TUI:\n" +
        "  docker compose -f packaging/docker/docker-compose.yml build --quiet torzlink\n" +
        "  docker compose -f packaging/docker/docker-compose.yml run --rm -it torzlink\n" +
        "  npm run docker:run\n\n" +
        "Plain docker run:\n" +
        "  docker run --rm -it -e TORZLINK_STATE_DIR=/data -e TORZLINK_DOWNLOAD_DIR=/downloads " +
        "-v torzlink-data:/data -v ./downloads:/downloads torzlink:latest\n\n",
    );
    process.exit(1);
  }

  // Enter the alt-screen and hide the hardware cursor: the TUI draws its own
  // cursor (the search field block, list pointers), so the terminal's should
  // stay hidden. restoreTerminal shows it again on exit.
  process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[22;0t\x1b]0;TorZlink\x07");
  if (process.platform === "win32") process.title = "TorZlink";

  let restored = false;
  function restoreTerminal(): void {
    if (restored) return;
    restored = true;
    process.stdout.write("\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[23;0t\x1b[?1049l");
  }

  let exiting = false;
  function forceExit(code = 0): void {
    if (exiting) {
      restoreTerminal();
      process.exit(code);
    }
    exiting = true;
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
