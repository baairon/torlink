import { isInfoHash } from "../sources/magnet";

export type CliCommand =
  | { kind: "version" }
  | { kind: "help" }
  | { kind: "run"; initialMagnet?: string; initialTorrent?: string }
  | { kind: "invalid"; arg: string };

export function parseCliArgs(argv: string[]): CliCommand {
  const args = argv.filter((a) => a.trim() !== "");
  if (args.length === 0) return { kind: "run" };
  const a = args[0]!;
  if (a === "--version" || a === "-v") return { kind: "version" };
  if (a === "--help" || a === "-h") return { kind: "help" };
  if (/^magnet:\?/i.test(a)) return { kind: "run", initialMagnet: a };
  if (isInfoHash(a)) return { kind: "run", initialMagnet: a };
  if (/\.torrent$/i.test(a)) return { kind: "run", initialTorrent: a };
  return { kind: "invalid", arg: a };
}

export const HELP_TEXT = `torlink, terminal-native torrent search

usage
  torlnk                      open the search TUI
  torlnk "magnet:?xt=..."     send a magnet to Deluge on launch
  torlnk path/to/file.torrent send a .torrent file to Deluge on launch
  torlnk --version            print the version

once open: type to search every source at once, enter to run, arrows to move,
d to send to Deluge, o to set your Deluge connection, ? for keys
tip: quote magnet links (they contain & characters)
`;
