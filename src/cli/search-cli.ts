import { mkdtemp, copyFile, mkdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SOURCES } from "../sources/registry";
import { cachedSearch } from "../sources/cache";
import { torrentExportName } from "../download/persist";
import { DownloadQueue } from "../download/queue";
import { formatBytes } from "../util/format";
import { normalizeSearchResult, rankSearchResults } from "./search-rank";

const MAX_SIZE_GB = Number(process.env.MAX_TORRENT_SIZE_GB ?? "6");
const MAX_SIZE_BYTES = Math.max(1, MAX_SIZE_GB) * 1024 ** 3;

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
  const settled = await Promise.allSettled(
    SOURCES.map(async (source) => {
      const results = await cachedSearch(source, query);
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
    if (item.status === "fulfilled") all.push(...item.value);
  }
  return all;
}

async function main(): Promise<number> {
  const query = process.argv.slice(2).join(" ").trim();
  if (!query) {
    console.error("Usage: node search.js \"content name\"");
    return 1;
  }

  const watchDir = readWatchDir();
  if (!watchDir) {
    console.error("QBIT_WATCH_DIR is not set.");
    return 1;
  }

  console.log(`Search: ${query}`);
  const ranked = rankSearchResults(query, await fetchSearchResults(query), { maxSizeBytes: MAX_SIZE_BYTES });
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
    const torrentPath = await queue.fetchAndExportTorrent(
      { id: selected.infoHash, name: selected.title, magnet: selected.torrentUrl, source: selected.source },
      tmpDir,
    );
    if (!torrentPath) {
      console.error("Failed to fetch torrent metadata.");
      return 1;
    }
    const finalName = torrentExportName(selected.title, selected.torrentUrl);
    const finalPath = await uniqueCopy(torrentPath, watchDir, finalName);
    const size = (await stat(finalPath)).size;
    console.log(`Wrote: ${finalPath} (${formatBytes(size)})`);
    return 0;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    queue.suspend();
  }
}

main()
  .then((code) => process.exitCode = code)
  .catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
