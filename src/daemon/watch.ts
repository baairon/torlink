// Headless watch-folder mode: torlnk watches a directory and downloads any
// torrent dropped into it. This is the "blackhole" pattern torrent clients use
// so other tools (a seedbox web app, a script, curl) can hand off a torrent by
// writing a file — no keypress, no TUI. Drop a `.torrent` file, or a `.magnet`
// / `.txt` file whose contents are a magnet URI or a bare info hash.

import { promises as fs } from "node:fs";
import path from "node:path";
import { startRuntime, addInput, type Runtime, type AddOutcome } from "./runtime";
import { startSeedReaper } from "./seed-reaper";

// Subfolders the watcher moves handled files into, so each is processed once and
// the drop folder stays tidy. Leading dots keep them out of the way and out of
// its own scans.
export const PROCESSED_DIR = ".processed";
export const FAILED_DIR = ".failed";

// Files we act on. A `.torrent` is handed off by path; `.magnet` / `.txt` hold a
// magnet URI or bare info hash as text. Everything else (partial writes ending
// in `.part`, the move-target subfolders, dotfiles) is ignored.
export function isWatchCandidate(name: string): boolean {
  if (name.startsWith(".")) return false;
  if (/\.part$/i.test(name)) return false;
  return /\.(torrent|magnet|txt)$/i.test(name);
}

// A dropped text file may have a trailing newline, comments, or blank lines.
// Take the first non-empty, non-comment line as the magnet / info hash.
export function firstMeaningfulLine(text: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line && !line.startsWith("#")) return line;
  }
  return null;
}

function log(message: string): void {
  const stamp = new Date().toISOString();
  console.log(`[torlnk watch] ${stamp} ${message}`);
}

async function moveInto(dir: string, sub: string, name: string): Promise<void> {
  const destDir = path.join(dir, sub);
  await fs.mkdir(destDir, { recursive: true }).catch(() => {});
  // Prefix with a timestamp so re-dropping a same-named file never clobbers a
  // previous one in the archive folder.
  const dest = path.join(destDir, `${Date.now()}-${name}`);
  await fs.rename(path.join(dir, name), dest).catch(() => {});
}

async function resolveInput(dir: string, name: string): Promise<string | null> {
  const full = path.join(dir, name);
  if (/\.torrent$/i.test(name)) return full; // handed off by path
  const text = await fs.readFile(full, "utf8").catch(() => "");
  return firstMeaningfulLine(text);
}

// Process one candidate file: add it, then archive it by outcome. Returns the
// outcome for logging/tests. Never throws — a bad file must not stop the loop.
export async function processFile(runtime: Runtime, dir: string, name: string): Promise<AddOutcome> {
  const input = await resolveInput(dir, name);
  let outcome: AddOutcome;
  try {
    outcome = input ? await addInput(runtime, input, { allowTorrentPath: true }) : "invalid";
  } catch {
    outcome = "invalid";
  }
  await moveInto(dir, outcome === "invalid" ? FAILED_DIR : PROCESSED_DIR, name);
  return outcome;
}

async function scanOnce(runtime: Runtime, dir: string): Promise<void> {
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  for (const name of entries) {
    if (!isWatchCandidate(name)) continue;
    const stat = await fs.stat(path.join(dir, name)).catch(() => null);
    if (!stat || !stat.isFile() || stat.size === 0) continue; // skip dirs / in-flight writes
    const outcome = await processFile(runtime, dir, name);
    log(`${outcome}: ${name}`);
  }
}

const POLL_MS = 2000;

// fs.watch is unreliable across platforms (misses events, fires twice, no
// recursion guarantees), so we poll — dead simple and identical on every OS.
export interface WatchOptions {
  seedTimeMs?: number;
  deleteFiles?: boolean;
}

export async function runWatch(
  watchDir: string,
  downloadDir?: string,
  options: WatchOptions = {},
): Promise<void> {
  const dir = path.resolve(watchDir);
  await fs.mkdir(dir, { recursive: true }).catch(() => {});

  const runtime = await startRuntime(downloadDir);
  runtime.queue.on("completed", (name: string) => log(`done, now seeding: ${name}`));

  if (options.seedTimeMs && options.seedTimeMs > 0) {
    startSeedReaper(runtime.queue, options.seedTimeMs, { deleteFiles: options.deleteFiles, log });
  }

  log(`watching ${dir}`);
  log(`downloads -> ${runtime.downloadDir}`);

  await scanOnce(runtime, dir);
  // Serialize scans: one in flight at a time so a slow add never overlaps itself.
  let scanning = false;
  const timer = setInterval(() => {
    if (scanning) return;
    scanning = true;
    void scanOnce(runtime, dir).finally(() => {
      scanning = false;
    });
  }, POLL_MS);

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      clearInterval(timer);
      runtime.queue.suspend();
      resolve();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}
