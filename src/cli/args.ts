import { isInfoHash } from "../sources/magnet";

export type CliCommand =
  | { kind: "version" }
  | { kind: "help" }
  | { kind: "run"; initialMagnet?: string; initialTorrent?: string }
  | { kind: "watch"; dir: string; downloadDir?: string }
  | { kind: "invalid"; arg: string };

// `--to <dir>` (alias `--dir`) overrides where finished files land, for the
// headless subcommands; returns the value and the remaining args.
function takeToFlag(rest: string[]): { downloadDir?: string; rest: string[] } {
  const out: string[] = [];
  let downloadDir: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if ((arg === "--to" || arg === "--dir") && i + 1 < rest.length) {
      downloadDir = rest[++i];
    } else {
      out.push(arg);
    }
  }
  return { downloadDir, rest: out };
}

export function parseCliArgs(argv: string[]): CliCommand {
  const args = argv.filter((a) => a.trim() !== "");
  if (args.length === 0) return { kind: "run" };
  const a = args[0]!;
  if (a === "--version" || a === "-v") return { kind: "version" };
  if (a === "--help" || a === "-h") return { kind: "help" };
  if (a === "watch") {
    const { downloadDir, rest } = takeToFlag(args.slice(1));
    const dir = rest[0];
    if (!dir) return { kind: "invalid", arg: "watch (missing directory)" };
    return { kind: "watch", dir, downloadDir };
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
  torlnk --version            print the version

once open: type to search every source at once, enter to run, arrows to move,
d to download, ? for keys
tip: quote magnet links (they contain & characters)

watch mode (no TUI): drop a .torrent, or a .magnet/.txt holding a magnet or
info hash, into <dir> and it downloads then seeds. Add --to <dir> to choose
where files land. Handled files move to <dir>/.processed (or /.failed).
`;
