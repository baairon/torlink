import { isInfoHash } from "../sources/magnet";
import { parseDuration } from "../util/duration";

export type CliCommand =
  | { kind: "version" }
  | { kind: "help" }
  | { kind: "run"; initialMagnet?: string; initialTorrent?: string }
  | {
      kind: "watch";
      dir: string;
      downloadDir?: string;
      seedTimeMs?: number;
      deleteFiles?: boolean;
      daemon?: boolean;
    }
  | {
      kind: "serve";
      port?: number;
      host?: string;
      token?: string;
      downloadDir?: string;
      seedTimeMs?: number;
      deleteFiles?: boolean;
      daemon?: boolean;
    }
  | { kind: "files"; port?: number; host?: string; token?: string; dir?: string; daemon?: boolean }
  | { kind: "attach" }
  | { kind: "update"; force?: boolean }
  | { kind: "invalid"; arg: string };

// Valueless boolean flags for the headless subcommands (everything else is a
// `--flag value` pair).
const BOOL_FLAGS = new Set(["delete-files", "daemon"]);

function splitBooleans(args: string[]): { bools: Set<string>; rest: string[] } {
  const bools = new Set<string>();
  const rest: string[] = [];
  for (const arg of args) {
    if (arg.startsWith("--") && BOOL_FLAGS.has(arg.slice(2))) bools.add(arg.slice(2));
    else rest.push(arg);
  }
  return { bools, rest };
}

// Minimal `--flag value` reader for the headless subcommands. Unknown tokens are
// left in `rest` so the caller can decide what to do with them.
function readFlags(args: string[]): { flags: Record<string, string>; rest: string[] } {
  const flags: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--") && i + 1 < args.length) {
      flags[arg.slice(2)] = args[++i]!;
    } else {
      rest.push(arg);
    }
  }
  return { flags, rest };
}

function parsePort(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function seedTimeFrom(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  return parseDuration(raw) ?? undefined;
}

export function parseCliArgs(argv: string[]): CliCommand {
  const args = argv.filter((a) => a.trim() !== "");
  if (args.length === 0) return { kind: "run" };
  const a = args[0]!;
  if (a === "--version" || a === "-v") return { kind: "version" };
  if (a === "--help" || a === "-h") return { kind: "help" };
  if (a === "attach") return { kind: "attach" };
  if (a === "update") return { kind: "update", force: args.slice(1).includes("--force") };
  if (a === "watch") {
    const { bools, rest: r0 } = splitBooleans(args.slice(1));
    const { flags, rest } = readFlags(r0);
    const dir = rest[0];
    if (!dir) return { kind: "invalid", arg: "watch (missing directory)" };
    return {
      kind: "watch",
      dir,
      downloadDir: flags.to ?? flags.dir,
      seedTimeMs: seedTimeFrom(flags["seed-time"]),
      deleteFiles: bools.has("delete-files"),
      daemon: bools.has("daemon"),
    };
  }
  if (a === "serve") {
    const { bools, rest: r0 } = splitBooleans(args.slice(1));
    const { flags } = readFlags(r0);
    return {
      kind: "serve",
      port: parsePort(flags.port),
      host: flags.host,
      token: flags.token,
      downloadDir: flags.to ?? flags.dir,
      seedTimeMs: seedTimeFrom(flags["seed-time"]),
      deleteFiles: bools.has("delete-files"),
      daemon: bools.has("daemon"),
    };
  }
  if (a === "files") {
    const { bools, rest: r0 } = splitBooleans(args.slice(1));
    const { flags } = readFlags(r0);
    return {
      kind: "files",
      port: parsePort(flags.port),
      host: flags.host,
      token: flags.token,
      dir: flags.dir,
      daemon: bools.has("daemon"),
    };
  }
  if (/^magnet:\?/i.test(a)) return { kind: "run", initialMagnet: a };
  if (isInfoHash(a)) return { kind: "run", initialMagnet: a };
  if (/\.torrent$/i.test(a)) return { kind: "run", initialTorrent: a };
  return { kind: "invalid", arg: a };
}

export const HELP_TEXT = `torlink, terminal-native torrent search

usage
  torlnk                      open the search TUI
  torlnk "magnet:?xt=..."     start a download on launch
  torlnk path/to/file.torrent open a .torrent file on launch
  torlnk watch <dir>          headless: download torrents dropped into <dir>
  torlnk serve                headless: HTTP add API (POST /add) on :9161
  torlnk files                headless: serve downloads over HTTP on :9160
  torlnk attach               open/reattach the TUI in a persistent tmux session
  torlnk update [--force]     update to the latest release and restart any daemon
                              (--force rebuilds/restarts even if already current)
  torlnk --version            print the version

once open: type to search every source at once, enter to run, arrows to move,
d to download, ? for keys
tip: quote magnet links (they contain & characters)

watch mode (no TUI): drop a .torrent, or a .magnet/.txt holding a magnet or
info hash, into <dir> and it downloads then seeds. Add --to <dir> to choose
where files land. Handled files move to <dir>/.processed (or /.failed).

seed mode (watch/serve): --seed-time <dur> stops seeding a torrent that long
after it finishes (e.g. 1h, 30m, 90s, 2d); files are kept by default. Add
--delete-files to also remove the downloaded data when the timer expires.

--daemon (watch/serve/files): background the process (own session, logs to a
file), so you can log out and it keeps running. Prints the pid and log path.

torlnk attach: run the TUI inside a persistent tmux session. Detach with
tmux's ctrl-b d, log out, then torlnk attach again to reattach where you
left off. Downloads and seeds keep running while detached.

serve mode (no TUI): a small HTTP API for handing torlink a magnet.
  POST /add {"magnet":"..."}   queue a magnet or info hash
  GET  /downloads              list active downloads and seeds
  GET  /health                 liveness (no auth)
flags: --port <n> (default 9161), --host <addr> (default 127.0.0.1),
--token <secret> (required to bind a public --host; or TORLINK_API_TOKEN),
--to <dir> (where files land).

files mode (no TUI): a read-only, range-aware HTTP server over the downloads
folder, so finished files stream to a browser or media player.
  GET /            list the folder (JSON)
  GET /<path>      stream a file (supports Range for seeking/resuming)
flags: --port <n> (default 9160), --host <addr> (default 127.0.0.1),
--token <secret> (required to bind a public --host; or TORLINK_FILES_TOKEN),
--dir <dir> (folder to serve; defaults to your downloads folder).
`;
