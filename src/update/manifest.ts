import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The package's own identity, read from the nearest package.json at runtime so
// nothing about the install is hardcoded: the registry check, the global
// reinstall target, and the update root all follow whatever manifest this code
// actually ships in.
export interface PackageManifest {
  name: string;
  version: string;
  root: string;
}

// Walk up from `fromUrl` (this module by default) to the first package.json
// carrying a string name and version. Covers the bundled dist (dist/index.js),
// the tsx dev tree (src/update), and a global npm install without hardcoding a
// depth or a package name.
export function readManifest(fromUrl: string = import.meta.url): PackageManifest | null {
  let dir = path.dirname(fileURLToPath(fromUrl));
  for (let i = 0; i < 6; i++) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
        name?: unknown;
        version?: unknown;
      };
      if (typeof raw.name === "string" && typeof raw.version === "string") {
        return { name: raw.name, version: raw.version, root: dir };
      }
    } catch {
      // no package.json here, or unreadable; keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
