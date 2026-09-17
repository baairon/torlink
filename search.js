import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// Node 22's built-in loader keeps this helper dependency-free. Environment
// variables supplied by the shell still take precedence over .env values.
try {
  process.loadEnvFile(path.join(here, ".env"));
} catch (e) {
  if (e?.code !== "ENOENT") throw e;
}
const entry = path.join(here, "src", "cli", "search-cli.ts");
const systemCa = process.platform === "win32" ? ["--use-system-ca"] : [];
const child = spawn(process.execPath, [...systemCa, "--import", "tsx", entry, ...process.argv.slice(2)], {
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});
