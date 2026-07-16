import { isInfoHash } from "../sources/magnet";

export type CliCommand =
  | { kind: "version" }
  | { kind: "help" }
  | { kind: "run"; initialMagnet?: string; initialTorrent?: string }
  | { kind: "serve"; host: string; port: number }
  | { kind: "invalid"; arg: string };

const DEFAULT_SERVE_HOST = "127.0.0.1";
const DEFAULT_SERVE_PORT = 8787;

function parseServeArgs(args: string[]): CliCommand {
  let host = DEFAULT_SERVE_HOST;
  let port = DEFAULT_SERVE_PORT;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--host" || a === "-H") {
      const v = args[++i];
      if (!v) return { kind: "invalid", arg: a };
      host = v;
      continue;
    }
    if (a.startsWith("--host=")) {
      host = a.slice("--host=".length) || DEFAULT_SERVE_HOST;
      continue;
    }
    if (a === "--port" || a === "-p") {
      const v = args[++i];
      if (!v) return { kind: "invalid", arg: a };
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 65535) return { kind: "invalid", arg: v };
      port = n;
      continue;
    }
    if (a.startsWith("--port=")) {
      const n = Number(a.slice("--port=".length));
      if (!Number.isInteger(n) || n < 1 || n > 65535) return { kind: "invalid", arg: a };
      port = n;
      continue;
    }
    return { kind: "invalid", arg: a };
  }
  return { kind: "serve", host, port };
}

export function parseCliArgs(argv: string[]): CliCommand {
  const args = argv.filter((a) => a.trim() !== "");
  if (args.length === 0) return { kind: "run" };
  const a = args[0]!;
  if (a === "--version" || a === "-v") return { kind: "version" };
  if (a === "--help" || a === "-h") return { kind: "help" };
  if (a === "serve") return parseServeArgs(args.slice(1));
  if (/^magnet:\?/i.test(a)) return { kind: "run", initialMagnet: a };
  if (isInfoHash(a)) return { kind: "run", initialMagnet: a };
  if (/\.torrent$/i.test(a)) return { kind: "run", initialTorrent: a };
  return { kind: "invalid", arg: a };
}

export const HELP_TEXT = `TorZlink — terminal-native torrent search

usage
  torzlink                      open the search TUI
  torzlink serve [--host HOST] [--port PORT]
                                start LAN web UI + API (default 127.0.0.1:8787)
  torzlink "magnet:?xt=..."     start a download on launch
  torzlink path/to/file.torrent open a .torrent file on launch
  torzlink --version            print the version

once open (TUI): type to search every source at once, enter to run, arrows to move,
d to download, ? for keys
tip: quote magnet links (they contain & characters)

serve mode: open http://HOST:PORT — search + download queue in the browser.
Protect with Traefik / LAN trust; there is no in-app login.
`;
