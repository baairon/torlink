import { promises as fs, mkdirSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { historyFile } from "../config/paths";
import { serializeWrites, writeJsonAtomic } from "../util/atomic";
import type { SourceId } from "../sources/types";

export const HISTORY_CAP = 500;

export interface HistoryItem {
  id: string;
  name: string;
  source?: SourceId;
  sizeBytes: number;
  magnet: string;
  dir: string;
  completedAt: number;
  subsLang?: string; // set once subtitles were fetched for this item
}

const write = serializeWrites();

export function saveHistory(items: HistoryItem[]): Promise<void> {
  return write(() => writeJsonAtomic(historyFile, items.slice(0, HISTORY_CAP)));
}

export function saveHistorySync(items: HistoryItem[]): void {
  try {
    mkdirSync(path.dirname(historyFile), { recursive: true });
    const tmp = `${historyFile}.sync.tmp`;
    writeFileSync(tmp, JSON.stringify(items.slice(0, HISTORY_CAP), null, 2), "utf8");
    renameSync(tmp, historyFile);
  } catch {}
}

function isHistoryItem(v: unknown): v is HistoryItem {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.name === "string" && typeof r.magnet === "string";
}

export async function loadHistory(): Promise<HistoryItem[]> {
  let raw: string;
  try {
    raw = await fs.readFile(historyFile, "utf8");
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isHistoryItem).slice(0, HISTORY_CAP) : [];
  } catch {
    return [];
  }
}
