// Headless HTTP file server: serve the downloads directory over HTTP so finished
// files can be streamed or fetched from another machine — a browser, a media
// player, a seedbox front-end. Read-only, range-aware (so video seeks and
// resumable downloads work), and rooted at the downloads folder with no way out.
//
// Default port 9160 sits beside Tor's SOCKS port (9050 / browser 9150); it's
// deliberately non-standard and overridable with --port.

import http from "node:http";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/config";

export const DEFAULT_FILES_PORT = 9160;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".wav": "audio/wav",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".srt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".nfo": "text/plain; charset=utf-8",
};

export function contentType(name: string): string {
  return MIME[path.extname(name).toLowerCase()] ?? "application/octet-stream";
}

// Resolve a request path against the root, refusing anything that escapes it
// (traversal, absolute paths, encoded ../). Returns an absolute path inside root
// or null. The empty path maps to the root itself (directory listing).
export function safeResolve(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const segments = decoded.split("/").filter((s) => s.length > 0);
  if (segments.some((s) => s === "..")) return null;
  const resolvedRoot = path.resolve(root);
  const full = path.resolve(resolvedRoot, ...segments);
  // Must be the root or strictly beneath it.
  if (full !== resolvedRoot && !full.startsWith(resolvedRoot + path.sep)) return null;
  return full;
}

export interface Range {
  start: number;
  end: number;
}

// Parse a single-range `bytes=start-end` header against a known size. Returns
// null for a missing/multi/malformed range (caller sends the whole file) and
// "unsatisfiable" when the range falls outside the file (caller sends 416).
export function parseRange(header: string | undefined, size: number): Range | null | "unsatisfiable" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const startRaw = m[1];
  const endRaw = m[2];
  if (startRaw === "" && endRaw === "") return null;
  let start: number;
  let end: number;
  if (startRaw === "") {
    // suffix range: last N bytes
    const n = Number.parseInt(endRaw!, 10);
    if (n <= 0) return "unsatisfiable";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number.parseInt(startRaw!, 10);
    end = endRaw === "" ? size - 1 : Number.parseInt(endRaw!, 10);
  }
  if (start > end || start >= size) return "unsatisfiable";
  if (end >= size) end = size - 1;
  return { start, end };
}

function authHeaderOk(token: string | null, authHeader: string | undefined): boolean {
  if (!token) return true;
  if (!authHeader) return false;
  const bearer = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const provided = bearer ? bearer[1]!.trim() : authHeader.trim();
  return provided === token;
}

function log(message: string): void {
  console.log(`[torlnk files] ${new Date().toISOString()} ${message}`);
}

async function sendListing(res: http.ServerResponse, dir: string, method: string): Promise<void> {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const entries = await Promise.all(
    names.map(async (name) => {
      const stat = await fs.stat(path.join(dir, name)).catch(() => null);
      return {
        name,
        type: stat?.isDirectory() ? "dir" : "file",
        size: stat?.isFile() ? stat.size : undefined,
      };
    }),
  );
  const payload = JSON.stringify({ entries });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(method === "HEAD" ? undefined : payload);
}

function sendFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  full: string,
  size: number,
): void {
  const type = contentType(full);
  const range = parseRange(req.headers.range, size);

  if (range === "unsatisfiable") {
    res.writeHead(416, { "Content-Range": `bytes */${size}` });
    res.end();
    return;
  }

  const headers: Record<string, string> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
  };

  if (range) {
    const length = range.end - range.start + 1;
    res.writeHead(206, {
      ...headers,
      "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
      "Content-Length": String(length),
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(full, { start: range.start, end: range.end }).pipe(res);
    return;
  }

  res.writeHead(200, { ...headers, "Content-Length": String(size) });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(full).pipe(res);
}

export interface FilesOptions {
  port?: number;
  host?: string;
  token?: string;
  dir?: string;
}

export async function runFiles(options: FilesOptions = {}): Promise<void> {
  const port = options.port ?? DEFAULT_FILES_PORT;
  const host = options.host ?? "127.0.0.1";
  const token = options.token && options.token.trim() ? options.token.trim() : null;

  // Fail soft, not open: don't expose the disk on a public interface tokenless.
  if (!LOOPBACK_HOSTS.has(host) && !token) {
    console.error(
      `error: refusing to bind ${host} without a token. Pass --token <secret> ` +
        `(or set TORLINK_FILES_TOKEN), or bind 127.0.0.1.`,
    );
    process.exit(1);
    return;
  }

  const root = path.resolve(
    options.dir && options.dir.trim() ? options.dir.trim() : (await loadConfig()).downloadDir,
  );
  await fs.mkdir(root, { recursive: true }).catch(() => {});

  const server = http.createServer((req, res) => {
    void (async () => {
      const method = req.method ?? "GET";
      if (method !== "GET" && method !== "HEAD") {
        res.writeHead(405, { "Content-Type": "application/json", Allow: "GET, HEAD" });
        res.end(JSON.stringify({ error: "method not allowed" }));
        return;
      }
      if (!authHeaderOk(token, req.headers.authorization)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      const urlPath = (req.url ?? "/").split("?")[0]!;
      const full = safeResolve(root, urlPath);
      if (!full) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "forbidden" }));
        return;
      }
      const stat = await fs.stat(full).catch(() => null);
      if (!stat) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      try {
        if (stat.isDirectory()) await sendListing(res, full, method);
        else sendFile(req, res, full, stat.size);
      } catch {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "internal error" }));
        }
      }
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(port, host, () => {
      log(`serving ${root} on http://${host}:${port}`);
      log(token ? "auth: token required" : "auth: none (loopback only)");
      resolve();
    });
  });

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      server.close();
      resolve();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}
