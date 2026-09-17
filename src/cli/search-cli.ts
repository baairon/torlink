import { mkdtemp, copyFile, mkdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SOURCES } from "../sources/registry";
import { cachedSearch } from "../sources/cache";
import { torrentExportName } from "../download/persist";
import { DownloadQueue } from "../download/queue";
import { formatBytes } from "../util/format";
import { normalizeSearchResult, rankSearchResults } from "./search-rank";
import { classificationSummary, classifyTorrentFile, watchDirForClassification } from "./torrent-classify";

const MAX_SIZE_GB = Number(process.env.MAX_TORRENT_SIZE_GB ?? "6");
const MAX_SIZE_BYTES = Math.max(1, MAX_SIZE_GB) * 1024 ** 3;
const DEBUG = process.env.TORLINK_SEARCH_DEBUG !== "0";

function ts(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  if (!DEBUG) return;
  console.error(`[${ts()}] ${message}`);
}

function logError(message: string): void {
  console.error(`[${ts()}] ${message}`);
}

function readWatchDir(): string | null {
  return process.env.QBIT_WATCH_DIR?.trim() || null;
}

function cleanFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
}

async function uniqueCopy(source: string, watchDir: string, name: string): Promise<string> {
  await mkdir(watchDir, { recursive: true });
  const base = cleanFilename(name) || "torrent";
  const targetBase = path.join(watchDir, base.endsWith(".torrent") ? base : `${base}.torrent`);
  const ext = path.extname(targetBase);
  const stem = targetBase.slice(0, -ext.length);
  let target = targetBase;
  for (let i = 0; i < 1000; i++) {
    try {
      await copyFile(source, target, 1);
      return target;
    } catch (e) {
      if (i === 999) throw e;
      target = `${stem} (${i + 1})${ext}`;
    }
  }
  return targetBase;
}

async function fetchSearchResults(query: string) {
  log(`searching ${SOURCES.length} sources`);
  const settled = await Promise.allSettled(
    SOURCES.map(async (source) => {
      log(`source start: ${source.id}`);
      const started = Date.now();
      const results = await cachedSearch(source, query);
      log(`source done: ${source.id} (${results.length} results, ${Date.now() - started}ms)`);
      return results.map((r) =>
        normalizeSearchResult({
          infoHash: r.infoHash,
          title: r.name,
          seeders: r.seeders,
          sizeBytes: r.sizeBytes,
          torrentUrl: r.magnet,
          source: r.source,
        }),
      );
    }),
  );
  const all = [];
  for (const item of settled) {
    if (item.status === "fulfilled") {
      all.push(...item.value);
      continue;
    }
    logError(`source failed: ${item.reason instanceof Error ? item.reason.message : String(item.reason)}`);
  }
  log(`search collected ${all.length} normalized results`);
  return all;
}

async function main(): Promise<number> {
  process.on("unhandledRejection", (reason) => {
    logError(`unhandledRejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
  });
  process.on("uncaughtException", (err) => {
    logError(`uncaughtException: ${err.stack ?? err.message}`);
  });

  const query = process.argv.slice(2).join(" ").trim();
  log(`argv: ${JSON.stringify(process.argv.slice(2))}`);
  if (!query) {
    logError("Usage: node search.js \"content name\"");
    return 1;
  }

  const defaultWatchDir = readWatchDir();
  if (!defaultWatchDir) {
    logError("QBIT_WATCH_DIR is not set.");
    return 1;
  }

  log(`query: ${query}`);
  log(`watch dir: ${defaultWatchDir}`);
  log(`max size: ${MAX_SIZE_BYTES} bytes (${MAX_SIZE_GB} GB)`);

  console.log(`Search: ${query}`);
  const results = await fetchSearchResults(query);
  log(`ranking ${results.length} candidates`);
  const ranked = rankSearchResults(query, results, { maxSizeBytes: MAX_SIZE_BYTES });
  log(`ranked ${ranked.length} acceptable candidates`);
  if (ranked.length === 0) {
    console.log("No acceptable torrent found.");
    return 0;
  }

  for (const [idx, r] of ranked.slice(0, 5).entries()) {
    console.log(
      `${idx + 1}. ${r.title} | ${formatBytes(r.sizeBytes)} | ${r.seeders} seeders${r.source ? ` | ${r.source}` : ""}`,
    );
  }

  const selected = ranked[0]!;
  console.log(`Selected: ${selected.title}`);

  const queue = new DownloadQueue();
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "torlink-search-"));
  try {
    log(`export staging dir: ${tmpDir}`);
    log(`fetching torrent metadata for ${selected.infoHash}`);
    const torrentPath = await queue.fetchAndExportTorrent(
      { id: selected.infoHash, name: selected.title, magnet: selected.torrentUrl },
      tmpDir,
      (reason) => logError(`Torrent metadata retrieval failed: ${reason}`),
    );
    if (!torrentPath) {
      logError("Failed to fetch torrent metadata.");
      return 1;
    }
    log(`torrent staged at ${torrentPath}`);
    let classification;
    try {
      classification = await classifyTorrentFile(torrentPath);
    } catch (e) {
      logError(`Torrent metadata inspection failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      classification = { type: "unknown" as const, audioBytes: 0, videoBytes: 0, totalBytes: 0 };
    }
    const watchDir = watchDirForClassification(classification, defaultWatchDir);
    log(`${classificationSummary(classification)} -> ${watchDir}`);
    const finalName = torrentExportName(selected.title, selected.torrentUrl);
    log(`copying to watch folder as ${finalName}`);
    const finalPath = await uniqueCopy(torrentPath, watchDir, finalName);
    const size = (await stat(finalPath)).size;
    console.log(`Wrote: ${finalPath} (${formatBytes(size)})`);
    return 0;
  } finally {
    log(`cleaning up staging dir ${tmpDir}`);
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    queue.suspend();
    log("shutdown complete");
  }
}

main()
  .then((code) => process.exitCode = code)
  .catch((e) => {
    logError(e instanceof Error ? e.stack ?? e.message : String(e));
    process.exitCode = 1;
  });
