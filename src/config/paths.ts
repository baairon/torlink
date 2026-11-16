import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import envPaths from "env-paths";

export const APP_NAME = "torlink";

const base = envPaths(APP_NAME, { suffix: "" });

// Optional override that relocates all persisted state under one folder. Tests
// point this at a temp dir so they never touch the real user data; it also
// doubles as a portable-state escape hatch. Off unless the env var is set.
const override = process.env.TORLINK_STATE_DIR;
const dataDir = override ? path.join(override, "data") : base.data;
const configDir = override ? path.join(override, "config") : base.config;

export const defaultDownloadDir = path.join(os.homedir(), "Downloads", APP_NAME);

export const configFile = path.join(configDir, "config.json");

export const queueFile = path.join(dataDir, "queue.json");

export const historyFile = path.join(dataDir, "history.json");

export const seedsFile = path.join(dataDir, "seeds.json");

// Per-torrent .torrent metadata, captured during download so a re-seed can
// verify the on-disk file locally instead of re-fetching it from the swarm.
export const torrentsDir = path.join(dataDir, "torrents");

// Armed just before boot hands saved state to the torrent engine, disarmed
// once the boot settles; see download/bootguard.ts.
export const bootMarkerFile = path.join(dataDir, "boot.marker");

// Where a --daemon headless run writes its log and pidfile.
export const logsDir = path.join(dataDir, "logs");

// Where the running TUI listens for a magnet or .torrent handed over by a
// later launch (see cli/handoff.ts). A socket file beside the state on Linux
// and macOS; Windows has no socket files, so a named pipe keyed on the state
// folder, which keeps it per user and per TORLINK_STATE_DIR there too.
export const handoffEndpoint =
  process.platform === "win32"
    ? `\\\\.\\pipe\\torlink-${createHash("sha1").update(dataDir).digest("hex").slice(0, 12)}`
    : path.join(dataDir, "handoff.sock");
