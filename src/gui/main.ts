import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, saveConfig, type Config } from "../config/config";
import { normalizeDownloadDir } from "../config/folder";
import { DownloadQueue } from "../download/queue";
import { loadQueue, loadSeeds } from "../download/persist";
import { loadHistory } from "../download/history";
import { reconcileQueue } from "../download/reconcile";
import { cachedSearch } from "../sources/cache";
import { SOURCES } from "../sources/registry";
import type { TorrentResult } from "../sources/types";

let window: BrowserWindow | null = null;
let queue: DownloadQueue;
let config: Config;
const guiDir = path.dirname(fileURLToPath(import.meta.url));

function snapshot() {
  return { config, downloads: queue.getItems(), history: queue.getHistory(), seeds: queue.getSeeds() };
}

function notify(): void {
  window?.webContents.send("torlink:state", snapshot());
}

async function startQueue(): Promise<void> {
  config = await loadConfig();
  queue = new DownloadQueue();
  queue.setTrackers(config.trackers);
  queue.restore(reconcileQueue(await loadQueue()));
  queue.restoreHistory(await loadHistory());
  queue.restoreSeeds(await loadSeeds());
  queue.on("update", notify);
  queue.on("completed", notify);
}

function dedupe(results: TorrentResult[]): TorrentResult[] {
  const best = new Map<string, TorrentResult>();
  for (const result of results) {
    const current = best.get(result.infoHash);
    if (!current || result.seeders > current.seeders) best.set(result.infoHash, result);
  }
  return [...best.values()].sort((a, b) => b.seeders - a.seeders || (b.added ?? 0) - (a.added ?? 0));
}

async function search(query: string): Promise<{ results: TorrentResult[]; errors: string[] }> {
  const settled = await Promise.allSettled(SOURCES.map((source) => cachedSearch(source, query)));
  const results: TorrentResult[] = [];
  const errors: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") results.push(...result.value);
    else errors.push(`${SOURCES[index]!.label}: unavailable`);
  });
  return { results: dedupe(results), errors };
}

app.whenReady().then(async () => {
  app.setAppUserModelId("dev.bairon.torlink");
  await startQueue();
  window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#10151d",
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  await window.loadFile(path.join(guiDir, "renderer", "index.html"));
  window.on("closed", () => { window = null; });
});

ipcMain.handle("torlink:state", () => snapshot());
ipcMain.handle("torlink:search", (_event, query: string) => search(query.trim()));
ipcMain.handle("torlink:add", async (_event, result: TorrentResult) => {
  await fs.mkdir(config.downloadDir, { recursive: true });
  queue.add({ id: result.infoHash, name: result.name, magnet: result.magnet, source: result.source, sizeBytes: result.sizeBytes }, config.downloadDir);
  notify();
});
ipcMain.handle("torlink:toggle", (_event, id: string) => { queue.togglePause(id); notify(); });
ipcMain.handle("torlink:open-folder", async (_event, folder?: string) => {
  const target = folder || config.downloadDir;
  await fs.mkdir(target, { recursive: true });
  return shell.openPath(target);
});
ipcMain.handle("torlink:choose-folder", async () => {
  const picked = await dialog.showOpenDialog(window!, { title: "Choose download folder", defaultPath: config.downloadDir, properties: ["openDirectory", "createDirectory"] });
  if (picked.canceled || !picked.filePaths[0]) return snapshot();
  const downloadDir = normalizeDownloadDir(picked.filePaths[0]);
  await fs.mkdir(downloadDir, { recursive: true });
  config = { ...config, downloadDir };
  await saveConfig(config);
  notify();
  return snapshot();
});
ipcMain.handle("torlink:set-folder", async (_event, raw: string) => {
  const downloadDir = normalizeDownloadDir(raw);
  if (!downloadDir) throw new Error("Enter a download folder.");
  await fs.mkdir(downloadDir, { recursive: true });
  config = { ...config, downloadDir };
  await saveConfig(config);
  notify();
  return snapshot();
});

app.on("window-all-closed", () => {
  queue?.suspend();
  if (process.platform !== "darwin") app.quit();
});

