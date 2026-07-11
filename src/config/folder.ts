import os from "node:os";
import path from "node:path";

// We read the raw input field, so expand a leading ~ ourselves (~\ too, for
// paths pasted from Windows). ~bob isn't us, so leave it alone.
export function expandHome(input: string, home: string = os.homedir()): string {
  const trimmed = input.trim();
  if (trimmed === "~") return home;
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(home, trimmed.slice(2));
  }
  return trimmed;
}

// Typed input -> a path for fs.mkdir. Blank returns "" (caller: leave it be).
export function normalizeDownloadDir(input: string, home: string = os.homedir()): string {
  const expanded = expandHome(input, home);
  if (!expanded) return "";
  return path.normalize(expanded);
}

export function getDownloadsDir(base: string): string {
  return path.join(base, "Downloads");
}

export function getSeedingDir(base: string): string {
  return path.join(base, "Seeding");
}

export function getCompletedDir(base: string): string {
  return path.join(base, "Completed");
}
