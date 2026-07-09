import { isInfoHash } from "../sources/magnet";

export type CliCommand =
  | { kind: "version" }
  | { kind: "help" }
  | { kind: "run"; initialMagnet?: string; initialTorrent?: string }
  | { kind: "watch"; dir: string; downloadDir?: string }
  | { kind: "serve"; port?: number; host?: string; token?: string; downloadDir?: string }
  | { kind: "files"; port?: number; host?: string; token?: string; dir?: string }
  | { kind: "invalid"; arg: string };

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

export function parseCliArgs(argv: string[]): CliCommand {
  const args = argv.filter((a) => a.trim() !== "");
  if (args.length === 0) return { kind: "run" };
  const a = args[0]!;
  if (a === "--version" || a === "-v") return { kind: "version" };
  if (a === "--help" || a === "-h") return { kind: "help" };
  if (a === "watch") {
    const { flags, rest } = readFlags(args.slice(1));
    const dir = rest[0];
    if (!dir) return { kind: "invalid", arg: "watch (missing directory)" };
    return { kind: "watch", dir, downloadDir: flags.to ?? flags.dir };
  }
  if (a === "serve") {
    const { flags } = readFlags(args.slice(1));
    const portNum = flags.port ? Number.parseInt(flags.port, 10) : undefined;
    return {
      kind: "serve",
      port: portNum && Number.isFinite(portNum) && portNum > 0 ? portNum : undefined,
      host: flags.host,
      token: flags.token,
      downloadDir: flags.to ?? flags.dir,
    };
  }
  if (a === "files") {
    const { flags } = readFlags(args.slice(1));
    const portNum = flags.port ? Number.parseInt(flags.port, 10) : undefined;
    return {
      kind: "files",
      port: portNum && Number.isFinite(portNum) && portNum > 0 ? portNum : undefined,
      host: flags.host,
      token: flags.token,
      dir: flags.dir,
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
  torlnk --version            print the version

once open: type to search every source at once, enter to run, arrows to move,
d to download, ? for keys
tip: quote magnet links (they contain & characters)

watch mode (no TUI): drop a .torrent, or a .magnet/.txt holding a magnet or
info hash, into <dir> and it downloads then seeds. Add --to <dir> to choose
where files land. Handled files move to <dir>/.processed (or /.failed).

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
