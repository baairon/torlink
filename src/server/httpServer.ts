import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TorzlinkRuntime } from "../core/runtime";
import { sanitizeDownloadInput, sanitizeMagnetInput } from "../sources/magnet";
import type { SourceId } from "../sources/types";
import { authorizeApi, serveToken } from "./auth";
import { searchAll } from "./searchAll";

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

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: TorzlinkRuntime,
  publicDir: string,
): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  if (method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, service: "torzlink", mode: "serve" });
    return;
  }

  if (method === "GET" && url.pathname === "/api/auth") {
    sendJson(res, 200, { required: Boolean(serveToken()) });
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    if (!requireApiAuth(req, res)) return;
  }

  if (method === "GET" && url.pathname === "/api/search") {
    const q = url.searchParams.get("q") ?? "";
    const out = await searchAll(q);
    sendJson(res, 200, out);
    return;
  }

  if (method === "GET" && url.pathname === "/api/downloads") {
    sendJson(res, 200, { items: runtime.queue.getItems().map(serializeDownload) });
    return;
  }

  if (method === "POST" && url.pathname === "/api/downloads") {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    } catch {
      sendJson(res, 400, { error: "invalid JSON body" });
      return;
    }

    const rawInput = typeof body.input === "string" ? body.input : null;
    const fromMagnet = rawInput ? sanitizeMagnetInput(rawInput) : null;
    const candidate = fromMagnet
      ? {
          id: fromMagnet.infoHash,
          name: fromMagnet.name,
          magnet: fromMagnet.magnet,
        }
      : {
          id: typeof body.id === "string" ? body.id : "",
          name: typeof body.name === "string" ? body.name : "",
          magnet: typeof body.magnet === "string" ? body.magnet : "",
          source: typeof body.source === "string" ? (body.source as SourceId) : undefined,
          sizeBytes: typeof body.sizeBytes === "number" ? body.sizeBytes : undefined,
        };

    const safe = sanitizeDownloadInput(candidate);
    if (!safe) {
      sendJson(res, 400, { error: "invalid magnet or infohash" });
      return;
    }

    const existed = runtime.queue.has(safe.id);
    await fs.mkdir(runtime.config.downloadDir, { recursive: true }).catch(() => {});
    runtime.queue.add(safe, runtime.config.downloadDir);
    if (!existed) {
      runtime.queue.emit("web-added", safe);
    }
    sendJson(res, existed ? 200 : 201, { ok: true, id: safe.id, existed });
    return;
  }

  const actionMatch = url.pathname.match(/^\/api\/downloads\/([^/]+)\/(pause|resume|cancel)$/);
  if (method === "POST" && actionMatch) {
    const id = decodeURIComponent(actionMatch[1]!);
    const action = actionMatch[2]!;
    if (!runtime.queue.has(id)) {
      sendJson(res, 404, { error: "download not found" });
      return;
    }
    if (action === "pause") runtime.queue.pause(id);
    else if (action === "resume") runtime.queue.resume(id);
    else runtime.queue.cancel(id);
    sendJson(res, 200, { ok: true, id, action });
    return;
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
