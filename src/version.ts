import { readFileSync } from "node:fs";

// Read the version from package.json so it can never drift from a release.
// Works from both src/ (tsx dev) and dist/ (bundled): each sits one level
// below the package root, where npm installs keep package.json too.
function readVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof version === "string" ? version : "unknown";
  } catch {
    return "unknown";
  }
}

export const VERSION = readVersion();
