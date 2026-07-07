import { promises as fs, mkdirSync, writeFileSync, renameSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { queueFile, seedsFile, torrentsDir } from "../config/paths";
import { serializeWrites, writeJsonAtomic } from "../util/atomic";
import type { QueueItem } from "./types";

const write = serializeWrites();

export function saveQueue(items: QueueItem[]): Promise<void> {
  return write(() => writeJsonAtomic(queueFile, items));
}

export function saveQueueSync(items: QueueItem[]): void {
  try {
    mkdirSync(path.dirname(queueFile), { recursive: true });
    const tmp = `${queueFile}.sync.tmp`;
    writeFileSync(tmp, JSON.stringify(items, null, 2), "utf8");
    renameSync(tmp, queueFile);
  } catch {}
}

function isQueueItem(v: unknown): v is QueueItem {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.magnet === "string";
}

export async function loadQueue(): Promise<QueueItem[]> {
  let raw: string;
  try {
    raw = await fs.readFile(queueFile, "utf8");
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isQueueItem) : [];
  } catch {
    return [];
  }
}

// We persist the user-meaningful seed states so a deliberate pause survives a
// restart (and stays paused), not just the seeding ids. Missing is runtime-only
// and gets folded to paused on the way out so a gone file is never auto-seeded.
export type PersistedSeedStatus = "seeding" | "paused";

export interface SeedRecord {
  id: string;
  status: PersistedSeedStatus;
}

export function saveSeeds(records: SeedRecord[]): Promise<void> {
  return write(() => writeJsonAtomic(seedsFile, records));
}

export function saveSeedsSync(records: SeedRecord[]): void {
  try {
    mkdirSync(path.dirname(seedsFile), { recursive: true });
    const tmp = `${seedsFile}.sync.tmp`;
    writeFileSync(tmp, JSON.stringify(records, null, 2), "utf8");
    renameSync(tmp, seedsFile);
  } catch {}
}

// --- per-torrent .torrent metadata cache ------------------------------------

export function torrentMetaPath(id: string): string {
  return path.join(torrentsDir, `${id}.torrent`);
}

export function torrentMetaExists(id: string): boolean {
  return existsSync(torrentMetaPath(id));
}

export function torrentExportName(name: string, id: string): string {
  const base = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return `${(base || id || "torrent").slice(0, 180)}.torrent`;
}

export async function saveTorrentMeta(id: string, data: Uint8Array): Promise<void> {
  try {
    await fs.mkdir(torrentsDir, { recursive: true });
    const file = torrentMetaPath(id);
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  } catch {}
}

export async function exportTorrentMeta(id: string, name: string, dir: string): Promise<string | null> {
  try {
    const source = torrentMetaPath(id);
    if (!existsSync(source)) return null;
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, torrentExportName(name, id));
    await fs.copyFile(source, target);
    return target;
  } catch {
    return null;
  }
}

export function deleteTorrentMeta(id: string): void {
  try {
    rmSync(torrentMetaPath(id), { force: true });
  } catch {}
}

export async function loadSeeds(): Promise<SeedRecord[]> {
  let raw: string;
  try {
    raw = await fs.readFile(seedsFile, "utf8");
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: SeedRecord[] = [];
    for (const el of parsed) {
      // Legacy format was a bare id array; treat each as a seeding entry.
      if (typeof el === "string") {
        out.push({ id: el, status: "seeding" });
      } else if (el && typeof el === "object") {
        const r = el as Record<string, unknown>;
        if (typeof r.id === "string" && (r.status === "seeding" || r.status === "paused")) {
          out.push({ id: r.id, status: r.status });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}
