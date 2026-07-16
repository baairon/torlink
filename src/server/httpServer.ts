import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { saveConfig } from "../config/config";
import { envVar } from "../config/env-vars";
import { normalizeDownloadDir } from "../config/folder";
import { parseTrackers, unknownTrackerHosts } from "../config/trackers";
import type { TorzlinkRuntime } from "../core/runtime";
import { notifyMagnetCopied } from "../integrations/telegram";
import { CATEGORIES, parseSourceGroup } from "../sources/categories";
import { sanitizeDownloadInput, sanitizeMagnetInput } from "../sources/magnet";
import type { SourceId } from "../sources/types";
import { lastClipboardFile, writeClipboard } from "../util/clipboard";
import { authorizeApi, serveToken } from "./auth";
import { getNetworkStatus, parseNetworkMode, setNetworkMode } from "./networkMode";
import { parseSearchSort, searchAll } from "./searchAll";

const MAX_BODY = 64 * 1024;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

export function defaultPublicDirCandidates(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.resolve(here, "web"),
    path.resolve(here, "../web"),
    path.resolve(here, "../../web"),
    path.resolve(process.cwd(), "web"),
    path.resolve(process.cwd(), "dist/web"),
  ];
}

async function resolvePublicDir(preferred?: string): Promise<string> {
  const candidates = preferred
    ? [preferred, ...defaultPublicDirCandidates()]
    : defaultPublicDirCandidates();
  for (const dir of candidates) {
    try {
      const st = await fs.stat(dir);
      if (st.isDirectory()) return dir;
    } catch {
      /* try next */
    }
  }
  return candidates[0]!;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(raw);
}

function sendText(
  res: ServerResponse,
  status: number,
  text: string,
  type = "text/plain; charset=utf-8",
): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_BODY) throw new Error("body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function serializeDownload(item: ReturnType<TorzlinkRuntime["queue"]["getItems"]>[number]) {
  return {
    id: item.id,
    name: item.name,
    source: item.source,
    status: item.status,
    progress: item.progress,
    totalBytes: item.totalBytes,
    downloadedBytes: item.downloadedBytes,
    speed: item.speed,
    peers: item.peers,
    eta: item.eta,
    error: item.error,
    addedAt: item.addedAt,
    dir: item.dir,
  };
}

function serializeHistory(
  item: ReturnType<TorzlinkRuntime["queue"]["getHistory"]>[number],
  includeMagnet: boolean,
) {
  return {
    id: item.id,
    name: item.name,
    source: item.source,
    sizeBytes: item.sizeBytes,
    dir: item.dir,
    completedAt: item.completedAt,
    ...(includeMagnet ? { magnet: item.magnet } : {}),
  };
}

function serializeSeed(item: ReturnType<TorzlinkRuntime["queue"]["getSeeds"]>[number]) {
  return {
    id: item.id,
    name: item.name,
    source: item.source,
    status: item.status,
    sizeBytes: item.sizeBytes,
    uploadSpeed: item.uploadSpeed,
    uploaded: item.uploaded,
    peers: item.peers,
    dir: item.dir,
  };
}

function parseHideDead(raw: string | null): boolean {
  if (!raw) return false;
  const t = raw.trim().toLowerCase();
  return t === "1" || t === "true" || t === "yes";
}

function requireApiAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (authorizeApi(req)) return true;
  sendJson(res, 401, {
    error: "unauthorized",
    hint: "Authorization: Bearer <TORZLINK_SERVE_TOKEN>",
  });
  return false;
}

export interface HttpServerOptions {
  runtime: TorzlinkRuntime;
  host: string;
  port: number;
  publicDir?: string;
}

export async function startHttpServer(opts: HttpServerOptions): Promise<Server> {
  const publicDir = await resolvePublicDir(opts.publicDir);
  const { runtime } = opts;

  const server = createServer((req, res) => {
    void handleRequest(req, res, runtime, publicDir).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) sendJson(res, 500, { error: message });
      else res.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => resolve());
  });

  return server;
}

type DownloadCandidate = {
  id: string;
  name: string;
  magnet: string;
  source?: SourceId;
  sizeBytes?: number;
};

function downloadCandidateFromBody(body: Record<string, unknown>): DownloadCandidate {
  const rawInput = typeof body.input === "string" ? body.input : null;
  const fromMagnet = rawInput ? sanitizeMagnetInput(rawInput) : null;
  if (fromMagnet) {
    return {
      id: fromMagnet.infoHash,
      name: fromMagnet.name,
      magnet: fromMagnet.magnet,
    };
  }
  return {
    id: typeof body.id === "string" ? body.id : "",
    name: typeof body.name === "string" ? body.name : "",
    magnet: typeof body.magnet === "string" ? body.magnet : "",
    source: typeof body.source === "string" ? (body.source as SourceId) : undefined,
    sizeBytes: typeof body.sizeBytes === "number" ? body.sizeBytes : undefined,
  };
}

async function readJsonBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readBody(req)) as Record<string, unknown>;
  } catch {
    sendJson(res, 400, { error: "invalid JSON body" });
    return null;
  }
}

async function handlePostDownloads(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: TorzlinkRuntime,
): Promise<void> {
  const body = await readJsonBody(req, res);
  if (!body) return;

  const safe = sanitizeDownloadInput(downloadCandidateFromBody(body));
  if (!safe) {
    sendJson(res, 400, { error: "invalid magnet or infohash" });
    return;
  }

  const existing = runtime.queue.getItems().find((it) => it.id === safe.id);
  if (existing && existing.status !== "failed") {
    sendJson(res, 409, {
      ok: false,
      error: "already in queue",
      id: safe.id,
      status: existing.status,
    });
    return;
  }

  await fs.mkdir(runtime.config.downloadDir, { recursive: true }).catch(() => {});
  runtime.queue.add(safe, runtime.config.downloadDir);
  runtime.queue.emit("web-added", safe);
  sendJson(res, 201, { ok: true, id: safe.id });
}

async function handlePostNetwork(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req, res);
  if (!body) return;
  const mode = parseNetworkMode(body.mode);
  if (!mode) {
    sendJson(res, 400, { error: "mode must be 'direct' or 'vpn'" });
    return;
  }
  sendJson(res, 200, { ok: true, ...(await setNetworkMode(mode)) });
}

function downloadDirLockedByEnv(): boolean {
  return Boolean(envVar("TORZLINK_DOWNLOAD_DIR", "TORLINK_DOWNLOAD_DIR"));
}

function serializeConfig(runtime: TorzlinkRuntime) {
  return {
    downloadDir: runtime.config.downloadDir,
    trackers: runtime.config.trackers,
    downloadDirLocked: downloadDirLockedByEnv(),
    unknownTrackerHosts: unknownTrackerHosts(runtime.config.trackers),
  };
}

function parseTrackersField(raw: unknown): string[] | null {
  if (typeof raw === "string") return parseTrackers(raw);
  if (!Array.isArray(raw)) return null;
  const joined: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") return null;
    joined.push(item);
  }
  return parseTrackers(joined.join("\n"));
}

type PatchFieldResult =
  | { ok: true; value: string }
  | { ok: false; status: number; body: Record<string, unknown> };

async function resolvePatchDownloadDir(
  raw: unknown,
  currentDir: string,
): Promise<PatchFieldResult> {
  if (typeof raw !== "string") {
    return { ok: false, status: 400, body: { error: "downloadDir must be a string" } };
  }
  const dir = normalizeDownloadDir(raw);
  if (!dir) {
    return { ok: false, status: 400, body: { error: "downloadDir is empty" } };
  }
  if (dir === currentDir) {
    return { ok: true, value: currentDir };
  }
  if (downloadDirLockedByEnv()) {
    return {
      ok: false,
      status: 409,
      body: {
        error: "downloadDir is locked by TORZLINK_DOWNLOAD_DIR",
        downloadDirLocked: true,
      },
    };
  }
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    return { ok: false, status: 400, body: { error: "couldn't use downloadDir" } };
  }
  return { ok: true, value: dir };
}

async function handlePatchConfig(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: TorzlinkRuntime,
): Promise<void> {
  const body = await readJsonBody(req, res);
  if (!body) return;

  const hasDownloadDir = Object.hasOwn(body, "downloadDir");
  const hasTrackers = Object.hasOwn(body, "trackers");
  if (!hasDownloadDir && !hasTrackers) {
    sendJson(res, 400, { error: "provide downloadDir and/or trackers" });
    return;
  }

  let nextDir = runtime.config.downloadDir;
  let nextTrackers = runtime.config.trackers;

  if (hasDownloadDir) {
    const resolved = await resolvePatchDownloadDir(body.downloadDir, runtime.config.downloadDir);
    if (!resolved.ok) {
      sendJson(res, resolved.status, resolved.body);
      return;
    }
    nextDir = resolved.value;
  }

  if (hasTrackers) {
    const parsed = parseTrackersField(body.trackers);
    if (!parsed) {
      sendJson(res, 400, { error: "trackers must be a string or string[]" });
      return;
    }
    nextTrackers = parsed;
  }

  runtime.config.downloadDir = nextDir;
  runtime.config.trackers = nextTrackers;
  runtime.queue.setTrackers(nextTrackers);
  await saveConfig(runtime.config);

  sendJson(res, 200, { ok: true, ...serializeConfig(runtime) });
}

async function handlePostCopyMagnet(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req, res);
  if (!body) return;

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const magnetRaw = typeof body.magnet === "string" ? body.magnet : "";
  const infoHashRaw = typeof body.infoHash === "string" ? body.infoHash : undefined;
  const safe = sanitizeDownloadInput({
    id: infoHashRaw ?? "",
    name: name || "torrent",
    magnet: magnetRaw,
  });
  if (!safe) {
    sendJson(res, 400, { error: "invalid magnet" });
    return;
  }

  const ok = await writeClipboard(safe.magnet, { name: safe.name, infoHash: safe.id });
  const savedPath = lastClipboardFile();
  if (ok) {
    notifyMagnetCopied({
      name: safe.name,
      magnet: safe.magnet,
      infoHash: safe.id,
    });
  }
  sendJson(res, ok ? 200 : 500, {
    ok,
    savedPath: savedPath ?? undefined,
    error: ok ? undefined : "couldn't copy magnet",
  });
}

const DOWNLOAD_ACTION_RE = /^\/api\/downloads\/([^/]+)\/(pause|resume|cancel)$/;
const HISTORY_ID_RE = /^\/api\/history\/([^/]+)$/;
const HISTORY_REDOWNLOAD_RE = /^\/api\/history\/([^/]+)\/redownload$/;
const SEED_ACTION_RE = /^\/api\/seeds\/([^/]+)\/(pause|resume|toggle)$/;

function handleDownloadAction(
  res: ServerResponse,
  runtime: TorzlinkRuntime,
  pathname: string,
): boolean {
  const actionMatch = DOWNLOAD_ACTION_RE.exec(pathname);
  if (!actionMatch) return false;

  const id = decodeURIComponent(actionMatch[1]!);
  const action = actionMatch[2]!;
  if (!runtime.queue.has(id)) {
    sendJson(res, 404, { error: "download not found" });
    return true;
  }
  if (action === "pause") runtime.queue.pause(id);
  else if (action === "resume") runtime.queue.resume(id);
  else runtime.queue.cancel(id);
  sendJson(res, 200, { ok: true, id, action });
  return true;
}

function handleHistoryDelete(
  res: ServerResponse,
  runtime: TorzlinkRuntime,
  pathname: string,
): boolean {
  const match = HISTORY_ID_RE.exec(pathname);
  if (!match) return false;
  const id = decodeURIComponent(match[1]!);
  const before = runtime.queue.getHistory().length;
  runtime.queue.removeHistory(id);
  if (runtime.queue.getHistory().length === before) {
    sendJson(res, 404, { error: "history item not found" });
    return true;
  }
  sendJson(res, 200, { ok: true, id });
  return true;
}

async function handleHistoryRedownload(
  res: ServerResponse,
  runtime: TorzlinkRuntime,
  pathname: string,
): Promise<boolean> {
  const match = HISTORY_REDOWNLOAD_RE.exec(pathname);
  if (!match) return false;
  const id = decodeURIComponent(match[1]!);
  const item = runtime.queue.getHistory().find((h) => h.id === id);
  if (!item) {
    sendJson(res, 404, { error: "history item not found" });
    return true;
  }
  const safe = sanitizeDownloadInput({
    id: item.id,
    name: item.name,
    magnet: item.magnet,
    source: item.source,
    sizeBytes: item.sizeBytes,
  });
  if (!safe) {
    sendJson(res, 400, { error: "invalid magnet in history" });
    return true;
  }
  const existing = runtime.queue.getItems().find((it) => it.id === safe.id);
  if (existing && existing.status !== "failed") {
    sendJson(res, 409, {
      ok: false,
      error: "already in queue",
      id: safe.id,
      status: existing.status,
    });
    return true;
  }
  const dir = item.dir || runtime.config.downloadDir;
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
  runtime.queue.add(safe, dir);
  runtime.queue.emit("web-added", safe);
  sendJson(res, 201, { ok: true, id: safe.id });
  return true;
}

function handleSeedAction(
  res: ServerResponse,
  runtime: TorzlinkRuntime,
  pathname: string,
): boolean {
  const match = SEED_ACTION_RE.exec(pathname);
  if (!match) return false;
  const id = decodeURIComponent(match[1]!);
  const action = match[2]!;
  const history = runtime.queue.getHistory().find((h) => h.id === id);
  if (!history) {
    sendJson(res, 404, { error: "seed/history item not found" });
    return true;
  }
  if (action === "pause") runtime.queue.stopSeeding(id);
  else if (action === "resume") runtime.queue.startSeeding(history);
  else runtime.queue.toggleSeeding(history);
  const seed = runtime.queue.getSeed(id);
  sendJson(res, 200, { ok: true, id, action, status: seed?.status ?? "paused" });
  return true;
}

async function handleGetSearch(res: ServerResponse, url: URL): Promise<void> {
  const q = url.searchParams.get("q") ?? "";
  const group =
    parseSourceGroup(url.searchParams.get("group")) ??
    parseSourceGroup(url.searchParams.get("category"));
  const hideDead = parseHideDead(url.searchParams.get("hideDead"));
  const sort = parseSearchSort(url.searchParams.get("sort"));
  sendJson(res, 200, await searchAll(q, { group, hideDead, sort }));
}

async function handleApiGet(
  res: ServerResponse,
  runtime: TorzlinkRuntime,
  url: URL,
): Promise<boolean> {
  switch (url.pathname) {
    case "/api/categories":
      sendJson(res, 200, { categories: CATEGORIES });
      return true;
    case "/api/search":
      await handleGetSearch(res, url);
      return true;
    case "/api/downloads":
      sendJson(res, 200, { items: runtime.queue.getItems().map(serializeDownload) });
      return true;
    case "/api/history":
      sendJson(res, 200, {
        items: runtime.queue.getHistory().map((h) => serializeHistory(h, true)),
      });
      return true;
    case "/api/seeds":
      sendJson(res, 200, { items: runtime.queue.getSeeds().map(serializeSeed) });
      return true;
    case "/api/network":
      sendJson(res, 200, await getNetworkStatus());
      return true;
    case "/api/config":
      sendJson(res, 200, serializeConfig(runtime));
      return true;
    default:
      return false;
  }
}

function handleApiDelete(
  res: ServerResponse,
  runtime: TorzlinkRuntime,
  pathname: string,
): boolean {
  if (pathname === "/api/history") {
    runtime.queue.clearHistory();
    sendJson(res, 200, { ok: true });
    return true;
  }
  return handleHistoryDelete(res, runtime, pathname);
}

async function handleApiPost(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: TorzlinkRuntime,
  url: URL,
): Promise<boolean> {
  if (await handleHistoryRedownload(res, runtime, url.pathname)) return true;
  if (handleSeedAction(res, runtime, url.pathname)) return true;

  switch (url.pathname) {
    case "/api/network":
      await handlePostNetwork(req, res);
      return true;
    case "/api/copy-magnet":
      await handlePostCopyMagnet(req, res);
      return true;
    case "/api/downloads":
      await handlePostDownloads(req, res, runtime);
      return true;
    default:
      return handleDownloadAction(res, runtime, url.pathname);
  }
}

async function handleApiRoute(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: TorzlinkRuntime,
  method: string,
  url: URL,
): Promise<boolean> {
  if (!requireApiAuth(req, res)) return true;

  if (method === "GET") return handleApiGet(res, runtime, url);
  if (method === "DELETE") return handleApiDelete(res, runtime, url.pathname);
  if (method === "POST") return handleApiPost(req, res, runtime, url);
  if (method === "PATCH" && url.pathname === "/api/config") {
    await handlePatchConfig(req, res, runtime);
    return true;
  }
  return false;
}

function handleUnauthenticatedGet(res: ServerResponse, method: string, pathname: string): boolean {
  if (method !== "GET") return false;
  if (pathname === "/health") {
    sendJson(res, 200, { ok: true, service: "torzlink", mode: "serve" });
    return true;
  }
  if (pathname === "/api/auth") {
    sendJson(res, 200, { required: Boolean(serveToken()) });
    return true;
  }
  return false;
}

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: TorzlinkRuntime,
  publicDir: string,
): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  if (handleUnauthenticatedGet(res, method, url.pathname)) return;

  if (url.pathname.startsWith("/api/")) {
    if (await handleApiRoute(req, res, runtime, method, url)) return;
  }

  if (method === "GET") {
    await serveStatic(res, publicDir, url.pathname);
    return;
  }

  sendJson(res, 405, { error: "method not allowed" });
}

/** Resolve a URL path under publicDir without sibling-prefix escapes. */
export function resolvePublicPath(publicDir: string, pathname: string): string | null {
  let rel = pathname === "/" ? "/index.html" : pathname;
  rel = decodeURIComponent(rel);
  if (rel.includes("\0") || rel.includes("\\")) return null;
  const root = path.resolve(publicDir);
  const resolved = path.resolve(root, "." + rel);
  const relToRoot = path.relative(root, resolved);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) return null;
  return resolved;
}

async function serveStatic(res: ServerResponse, publicDir: string, pathname: string): Promise<void> {
  const resolved = resolvePublicPath(publicDir, pathname);
  if (!resolved) {
    sendText(res, 400, "bad path");
    return;
  }
  try {
    const data = await fs.readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control": ext === ".html" ? "no-store" : "public, max-age=3600",
    });
    res.end(data);
  } catch {
    if (pathname === "/" || !path.extname(pathname)) {
      const indexPath = resolvePublicPath(publicDir, "/index.html");
      if (indexPath) {
        try {
          const index = await fs.readFile(indexPath);
          res.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
          });
          res.end(index);
          return;
        } catch {
          /* fall through */
        }
      }
    }
    sendText(res, 404, "not found");
  }
}
