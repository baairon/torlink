import path from "node:path";
import envPaths from "env-paths";

export const APP_NAME = "torlink";

const base = envPaths(APP_NAME, { suffix: "" });

// Optional override that relocates persisted state under one folder. Tests
// point this at a temp dir so they never touch the real user data.
const override = process.env.TORLINK_STATE_DIR;
const configDir = override ? path.join(override, "config") : base.config;

export const configFile = path.join(configDir, "config.json");
