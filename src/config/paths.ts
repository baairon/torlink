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

// Where a --daemon headless run writes its log and pidfile.
export const logsDir = path.join(dataDir, "logs");
