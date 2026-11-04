import { isIPv6 } from "node:net";
import { isInfoHash } from "../sources/magnet";
import { parseDuration } from "../util/duration";
import { validPort, type NetworkOptions } from "../download/network";

export type SearchCategory = "games" | "movies" | "tv" | "anime";

export type CliCommand =
  | { kind: "version" }
  | { kind: "help" }
  | {
      kind: "run";
      initialMagnet?: string;
      initialTorrent?: string;
      playlist?: boolean;
      network?: NetworkOptions;
    }
  | {
      kind: "watch";
      playlist?: boolean;
      network?: NetworkOptions;
      dir: string;
      downloadDir?: string;
      seedTimeMs?: number;
      deleteFiles?: boolean;
      daemon?: boolean;
    }
  | {
      kind: "serve";
      playlist?: boolean;
      network?: NetworkOptions;
      port?: number;
      host?: string;
      token?: string;
      downloadDir?: string;
      seedTimeMs?: number;
      deleteFiles?: boolean;
      daemon?: boolean;
    }
  | {
      kind: "seed";
      path: string;
      network?: NetworkOptions;
      seedTimeMs?: number;
      deleteFiles?: boolean;
      daemon?: boolean;
    }
  | { kind: "files"; port?: number; host?: string; token?: string; dir?: string; daemon?: boolean }
  | { kind: "attach" }
  | { kind: "update"; force?: boolean }
  | {
      kind: "search";
      query: string;
      category?: SearchCategory;
      timeoutMs?: number;
      network?: NetworkOptions;
    }
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
  const taken = takeNetworkFlags(argv);
  if (taken.error !== undefined) return { kind: "invalid", arg: taken.error };
  return withNetwork(withPlaylist(taken.rest), taken.network);
}

function withPlaylist(argv: string[]): CliCommand {
  const noPlaylist = argv.includes("--no-playlist");
  const cmd = parseCommand(argv.filter((arg) => arg !== "--no-playlist"));
  if (!noPlaylist || cmd.kind === "invalid" || cmd.kind === "help" || cmd.kind === "version") return cmd;
  if (cmd.kind === "run" || cmd.kind === "watch" || cmd.kind === "serve") {
    return { ...cmd, playlist: false };
  }
  return { kind: "invalid", arg: "--no-playlist (use with the TUI, watch, or serve)" };
}

// Global `--flag value` pairs, taken out before the command is read so the
// per-command readers never see them. Strict on purpose, unlike parsePort: a
// kill-switch flag that was silently dropped would run unbound.
const NETWORK_FLAGS: Record<string, keyof NetworkOptions> = {
  "--interface": "interface",
  "--peer-port": "peerPort",
  "--dht-port": "dhtPort",
};

function takeNetworkFlags(argv: string[]): { rest: string[]; network?: NetworkOptions; error?: string } {
  const rest: string[] = [];
  const network: NetworkOptions = {};
  let any = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const key = NETWORK_FLAGS[arg];
    if (!key) {
      rest.push(arg);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--") || !value.trim()) {
      return { rest, error: `${arg} (missing value)` };
    }
    i++;
    if (key === "interface") {
      if (isIPv6(value.trim())) return { rest, error: `${arg} (IPv4 only: '${value}')` };
      network.interface = value.trim();
    } else {
      const n = Number(value);
      if (!validPort(n)) return { rest, error: `${arg} (invalid port '${value}')` };
      network[key] = n;
    }
    any = true;
  }
  if (network.peerPort !== undefined && network.peerPort === network.dhtPort) {
    return { rest, error: "--dht-port (must differ from --peer-port)" };
  }
  return any ? { rest, network } : { rest };
}

function withNetwork(cmd: CliCommand, network?: NetworkOptions): CliCommand {
  if (!network) return cmd;
  switch (cmd.kind) {
    case "run":
    case "watch":
    case "serve":
    case "seed":
      return { ...cmd, network };
    case "search":
      if (network.peerPort !== undefined || network.dhtPort !== undefined) {
        return { kind: "invalid", arg: "--peer-port / --dht-port (use with the TUI, watch, serve, or seed)" };
      }
      return { ...cmd, network };
    case "invalid":
    case "help":
    case "version":
      return cmd;
    default:
      return { kind: "invalid", arg: "--interface (use with the TUI, watch, serve, seed, or search)" };
  }
}

function parseCommand(argv: string[]): CliCommand {
  const args = argv.filter((a) => a.trim() !== "");
  if (args.length === 0) return { kind: "run" };
  const a = args[0]!;
  if (a === "--version" || a === "-v") return { kind: "version" };
  if (a === "--help" || a === "-h") return { kind: "help" };
  if (a === "attach") return { kind: "attach" };
  if (a === "update") return { kind: "update", force: args.slice(1).includes("--force") };
  if (a === "search") {
    const { flags, rest } = readFlags(args.slice(1));
    const unknownFlag = Object.keys(flags).find(
      (flag) => flag !== "category" && flag !== "timeout",
    );
    const danglingFlag = rest.find((arg) => arg.startsWith("--"));
    if (unknownFlag) return { kind: "invalid", arg: `search (unknown --${unknownFlag})` };
    if (danglingFlag) return { kind: "invalid", arg: `search (invalid ${danglingFlag})` };

    const query = rest.join(" ").trim();
    if (!query) return { kind: "invalid", arg: "search (missing query)" };

    // Unlike --seed-time, 0 is refused rather than read as "no limit": a
    // caller passing down what is left of its own budget should get an error
    // when that reaches zero, not a search that never gives up.
    const timeoutMs = flags.timeout === undefined ? undefined : parseDuration(flags.timeout);
    if (timeoutMs === null || timeoutMs === 0) {
      return { kind: "invalid", arg: `search (invalid timeout '${flags.timeout}')` };
    }

    const category = flags.category;
    if (category === undefined) return { kind: "search", query, timeoutMs };
    if (
      category === "games" ||
      category === "movies" ||
      category === "tv" ||
      category === "anime"
    ) {
      return { kind: "search", query, category, timeoutMs };
    }
    return { kind: "invalid", arg: `search (invalid category '${category}')` };
  }
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
  if (a === "seed") {
    const { bools, rest: r0 } = splitBooleans(args.slice(1));
    const { flags, rest } = readFlags(r0);
    const target = rest[0];
    if (!target) return { kind: "invalid", arg: "seed (missing path)" };
    return {
      kind: "seed",
      path: target,
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
  torlnk search <query>        headless: print search results as JSON
    [--category games|movies|tv|anime] [--timeout <dur>]
  torlnk seed <path>          headless: share files you already have
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

playlists (TUI/watch/serve): finished downloads automatically get a
playlist.m3u in each folder containing 2+ audio/video files, including nested
folders, in natural filename order. Single-file folders are skipped and
existing playlists are kept. Pass --no-playlist (or set TORLINK_NO_PLAYLIST=1)
to disable creation; existing playlists remain on disk.

search (no TUI): one JSON document on stdout, with a per-source report under
"sources". --timeout <dur> caps the whole search (default 45s; e.g. 20s, 2m).
A source that has not answered by then is reported with code "timeout" and
the results from the others still print. Exit 1 only when no source answered.

watch mode (no TUI): drop a .torrent, or a .magnet/.txt holding a magnet or
info hash, into <dir> and it downloads then seeds. Add --to <dir> to choose
where files land. Handled files move to <dir>/.processed (or /.failed).

seed a path (no TUI): torlnk seed ./album turns the folder into a torrent,
saves album.torrent next to it, prints the magnet, and starts sharing. Send
anyone the magnet and they pull the files from you. Takes --seed-time,
--delete-files and --daemon.

seed expiry (seed/watch/serve): --seed-time <dur> stops seeding a torrent that long
after it finishes (e.g. 1h, 30m, 90s, 2d); files are kept by default. Add
--delete-files to also remove the downloaded data when the timer expires.
One torrent can carry its own limit over the serve API (seedTime on /add, or
the seed-time control action); that wins over --seed-time, and 0 keeps it
seeding for good.

--daemon (watch/serve/files): background the process (own session, logs to a
file), so you can log out and it keeps running. Prints the pid and log path.

network (TUI/watch/serve/seed; search takes --interface alone):
  --interface <name|ip>  bind every peer, tracker, DHT and search socket to one
                         interface (wg0, tun0, NordLynx, utun4) or its IPv4
                         address. If it drops, downloads and seeds pause instead
                         of falling back to another route, and resume on their
                         own when it is back, on its new address if that
                         changed. LSD, UPnP, NAT-PMP and WebRTC peers stay off:
                         whoever owns the interface's gateway owns the port map.
  --peer-port <n>        fixed TCP/uTP listen port, the one to forward for
                         incoming peers (random otherwise)
  --dht-port <n>         fixed DHT UDP port (must differ from --peer-port)
Env: TORLINK_INTERFACE, TORLINK_PEER_PORT, TORLINK_DHT_PORT (flags win; a
daemon restarted by torlnk update keeps its flags, not its environment).
IPv4 only; DNS lookups use the OS resolver, and the git/npm processes that
torlnk update spawns are not bound.
serve adds GET /network (address, online, listen port, incoming peers) and
POST /network {"interface":..,"peerPort":..,"dhtPort":..} to change them in
place, no restart; null clears a field.

torlnk attach: run the TUI inside a persistent tmux session. Detach with
tmux's ctrl-b d, log out, then torlnk attach again to reattach where you
left off. Downloads and seeds keep running while detached.

serve mode (no TUI): a small HTTP API for handing torlink a magnet.
  POST /add {"magnet":"..."}   queue a magnet or info hash
       ... "seedTime":"30d"      optional: this torrent's own seed limit
                                (0 = never stop); overrides --seed-time
  POST /add {"torrent":"<b64>"} queue an uploaded .torrent (base64 or data: URI)
  POST /control {"id":"...","action":"seed-time","seedTime":"30d"}
                               change a torrent's seed limit ("" = inherit);
                               other actions: pause, resume, start-seed,
                               stop-seed, remove, delete
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
