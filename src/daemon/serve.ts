// Headless HTTP add API: torlnk exposes a tiny local server so another program
// (a seedbox web app, a script, curl) can hand it a torrent over HTTP instead of
// a keypress. It complements the watch folder — same headless runtime, a
// different doorway.
//
// Default port 9161 sits next to Tor's control port (9051 / browser 9151); it's
// deliberately non-standard and overridable with --port. Binds 127.0.0.1 by
// default; exposing it on a public interface requires a token.

import http from "node:http";
import { startRuntime, addInput, type Runtime } from "./runtime";
import { VERSION } from "../version";

export const DEFAULT_API_PORT = 9161;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const MAX_BODY_BYTES = 64 * 1024; // a magnet is small; cap the body hard

export interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface ServeOptions {
  port?: number;
  host?: string;
  token?: string;
  downloadDir?: string;
}

// Constant-ish comparison — the token isn't a password hash, but don't leak
// length via early exit on the common prefix.
function tokenMatches(expected: string, provided: string): boolean {
  if (expected.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}

export function isAuthorized(token: string | null, authHeader: string | undefined): boolean {
  if (!token) return true; // no token configured -> open (loopback only, enforced at bind)
  if (!authHeader) return false;
  const bearer = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const provided = bearer ? bearer[1]!.trim() : authHeader.trim();
  return tokenMatches(token, provided);
}

// Pull a magnet / info hash out of a request body. Accepts JSON ({ magnet } or
// { infohash }) or a raw body that is itself a magnet or info hash — forgiving,
// so callers don't have to guess the exact envelope.
export function extractMagnet(bodyText: string): string | null {
  const raw = bodyText.trim();
  if (!raw) return null;
  if (raw.startsWith("{")) {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const val = obj.magnet ?? obj.infohash ?? obj.infoHash ?? obj.hash;
      return typeof val === "string" && val.trim() ? val.trim() : null;
    } catch {
      return null;
    }
  }
  return raw;
}

function statusPayload(runtime: Runtime): Record<string, unknown> {
  const downloads = runtime.queue.getItems().map((it) => ({
    id: it.id,
    name: it.name,
    status: it.status,
    progress: it.progress,
    peers: it.peers,
    speed: it.speed,
  }));
  const seeds = runtime.queue.getSeeds().map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    peers: s.peers,
    uploaded: s.uploaded,
  }));
  return { downloads, seeds };
}

// Pure request router — no node:http types, so it's trivially testable.
export async function handleApi(
  runtime: Runtime,
  token: string | null,
  method: string,
  urlPath: string,
  authHeader: string | undefined,
  bodyText: string,
): Promise<ApiResponse> {
  if (method === "GET" && urlPath === "/health") {
    return { status: 200, body: { ok: true, version: VERSION } };
  }
  if (!isAuthorized(token, authHeader)) {
    return { status: 401, body: { error: "unauthorized" } };
  }
  if (method === "GET" && (urlPath === "/downloads" || urlPath === "/status")) {
    return { status: 200, body: statusPayload(runtime) };
  }
  if (method === "POST" && urlPath === "/add") {
    const magnet = extractMagnet(bodyText);
    if (!magnet) return { status: 400, body: { error: "missing magnet or info hash" } };
    const outcome = await addInput(runtime, magnet);
    if (outcome === "invalid") return { status: 400, body: { error: "invalid magnet or info hash" } };
    return { status: 200, body: { ok: true, outcome } };
  }
  return { status: 404, body: { error: "not found" } };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        resolve("");
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(""));
  });
}

function log(message: string): void {
  console.log(`[torlnk serve] ${new Date().toISOString()} ${message}`);
}

export async function runServe(options: ServeOptions = {}): Promise<void> {
  const port = options.port ?? DEFAULT_API_PORT;
  const host = options.host ?? "127.0.0.1";
  const token = options.token && options.token.trim() ? options.token.trim() : null;

  // Fail soft, not open: never expose a public interface without a token.
  if (!LOOPBACK_HOSTS.has(host) && !token) {
    console.error(
      `error: refusing to bind ${host} without a token. Pass --token <secret> ` +
        `(or set TORLINK_API_TOKEN), or bind 127.0.0.1.`,
    );
    process.exit(1);
    return;
  }

  const runtime = await startRuntime(options.downloadDir);

  const server = http.createServer((req, res) => {
    void (async () => {
      const method = req.method ?? "GET";
      const urlPath = (req.url ?? "/").split("?")[0]!;
      const bodyText = method === "POST" ? await readBody(req) : "";
      let out: ApiResponse;
      try {
        out = await handleApi(runtime, token, method, urlPath, req.headers.authorization, bodyText);
      } catch {
        out = { status: 500, body: { error: "internal error" } };
      }
      const payload = JSON.stringify(out.body);
      res.writeHead(out.status, { "Content-Type": "application/json" });
      res.end(payload);
      if (method !== "GET" || urlPath !== "/health") {
        log(`${method} ${urlPath} -> ${out.status}`);
      }
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(port, host, () => {
      log(`listening on http://${host}:${port}  (downloads -> ${runtime.downloadDir})`);
      log(token ? "auth: token required" : "auth: none (loopback only)");
      resolve();
    });
  });

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      server.close();
      runtime.queue.suspend();
      resolve();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}
