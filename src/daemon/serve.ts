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
import { startSeedReaper } from "./seed-reaper";
import { acquireInstanceLock, releaseInstanceLock, removeRunDescriptor } from "./daemonize";
import { LOOPBACK_HOSTS, isAuthorized, hostHeaderOk } from "./auth";
import { VERSION } from "../version";

export { isAuthorized } from "./auth";

export const DEFAULT_API_PORT = 9161;

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
  /** Stop seeding each torrent this long after it finishes (ms). */
  seedTimeMs?: number;
  /** With seedTimeMs, also delete the files when the timer expires. */
  deleteFiles?: boolean;
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

// Control actions the headless API accepts (POST /control). A seedbox web app
// drives per-torrent buttons through these instead of the interactive keymap.
export const CONTROL_ACTIONS = [
  "pause", // pause an active/queued download
  "resume", // resume a paused download
  "start-seed", // (re)start seeding a finished torrent
  "stop-seed", // stop seeding but keep the files
  "remove", // forget the torrent, keep files on disk
  "delete", // forget the torrent AND delete its files
] as const;
export type ControlAction = (typeof CONTROL_ACTIONS)[number];

export interface ControlRequest {
  id: string;
  action: string;
  deleteFiles: boolean;
}

// Parse a control request body: JSON { id, action, deleteFiles? }. Returns null
// for anything missing the two required string fields; the action string itself
// is validated later so an unknown action gets a precise error.
export function parseControl(bodyText: string): ControlRequest | null {
  const raw = bodyText.trim();
  if (!raw.startsWith("{")) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  const action = typeof obj.action === "string" ? obj.action.trim() : "";
  if (!id || !action) return null;
  return { id, action, deleteFiles: obj.deleteFiles === true };
}

export type ControlOutcome =
  | "ok"
  | "noop"
  | "not-found"
  | "unknown-action"
  | "delete-failed"
  | "shutting-down";

// Apply a parsed control request to the queue. Pure over the runtime so it's
// unit-testable with a fake queue.
export async function applyControl(
  runtime: Runtime,
  req: ControlRequest,
): Promise<ControlOutcome> {
  if (runtime.shuttingDown) return "shutting-down";
  const q = runtime.queue;
  const { id, action, deleteFiles } = req;
  switch (action as ControlAction) {
    case "pause":
      if (!q.has(id)) return "not-found";
      // pause() reports whether state actually changed (a failed/completed
      // item can't be paused) so the API doesn't confirm a phantom action.
      return q.pause(id) ? "ok" : "noop";
    case "resume":
      if (!q.has(id)) return "not-found";
      return q.resume(id) ? "ok" : "noop";
    case "stop-seed":
      if (!q.getSeed(id)) return "not-found";
      return q.stopSeeding(id) ? "ok" : "noop";
    case "start-seed": {
      const h = q.getHistory().find((x) => x.id === id);
      if (!h) return "not-found";
      return q.startSeeding(h) ? "ok" : "noop";
    }
    case "remove":
    case "delete": {
      const wantsDelete = action === "delete" || deleteFiles;
      const res = await q.remove(id, { deleteFiles: wantsDelete });
      if (!res) return "not-found";
      // The torrent is gone either way; say so when its files couldn't be.
      if (wantsDelete && res.deleted === false) return "delete-failed";
      return "ok";
    }
    default:
      return "unknown-action";
  }
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
    if (outcome === "shutting-down") return { status: 503, body: { error: "shutting down" } };
    return { status: 200, body: { ok: true, outcome } };
  }
  if (method === "POST" && urlPath === "/control") {
    const req = parseControl(bodyText);
    if (!req) return { status: 400, body: { error: "missing or invalid { id, action }" } };
    const outcome = await applyControl(runtime, req);
    if (outcome === "unknown-action") {
      return { status: 400, body: { error: `unknown action: ${req.action}` } };
    }
    if (outcome === "not-found") return { status: 404, body: { error: "no such torrent" } };
    if (outcome === "shutting-down") return { status: 503, body: { error: "shutting down" } };
    if (outcome === "delete-failed") {
      return {
        status: 500,
        body: { error: "torrent removed, but its files could not be deleted (still on disk)" },
      };
    }
    return { status: 200, body: { ok: true, id: req.id, action: req.action, changed: outcome === "ok" } };
  }
  return { status: 404, body: { error: "not found" } };
}

// Read the body up to the size cap. On overflow resolve tooLarge immediately
// (further chunks are ignored) so the caller can answer 413 on a live socket
// and close the connection afterwards, instead of writing to a destroyed one.
function readBody(req: http.IncomingMessage): Promise<{ text: string; tooLarge: boolean }> {
  return new Promise((resolve) => {
    let size = 0;
    let settled = false;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      if (settled) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        settled = true;
        resolve({ text: "", tooLarge: true });
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve({ text: Buffer.concat(chunks).toString("utf8"), tooLarge: false });
    });
    req.on("error", () => {
      if (settled) return;
      settled = true;
      resolve({ text: "", tooLarge: false });
    });
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

  // Two instances would clobber each other's queue/seeds/history files.
  if (!acquireInstanceLock("serve")) {
    console.error("error: another torlnk serve is already running. Stop it first.");
    process.exit(1);
    return;
  }

  const runtime = await startRuntime(options.downloadDir);

  if (options.seedTimeMs && options.seedTimeMs > 0) {
    startSeedReaper(runtime.queue, options.seedTimeMs, { deleteFiles: options.deleteFiles, log });
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      const method = req.method ?? "GET";
      const urlPath = (req.url ?? "/").split("?")[0]!;
      // Tokenless means loopback-bound; require a loopback Host so a hostile
      // webpage can't reach us through DNS rebinding.
      if (!token && !hostHeaderOk(req.headers.host)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "forbidden host" }));
        log(`${method} ${urlPath} -> 403 (host)`);
        return;
      }
      const body = method === "POST" ? await readBody(req) : { text: "", tooLarge: false };
      if (body.tooLarge) {
        res.writeHead(413, { "Content-Type": "application/json", Connection: "close" });
        res.end(JSON.stringify({ error: "body too large" }));
        res.once("finish", () => req.destroy());
        log(`${method} ${urlPath} -> 413`);
        return;
      }
      const bodyText = body.text;
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

  await new Promise<void>((resolve, reject) => {
    // listen() failures (EADDRINUSE, EACCES, bad port) arrive as an async
    // "error" event; with no listener the daemon would die on an uncaught
    // exception and a raw stack. Surface a clean message instead.
    server.once("error", reject);
    server.listen(port, host, () => {
      log(`listening on http://${host}:${port}  (downloads -> ${runtime.downloadDir})`);
      log(token ? "auth: token required" : "auth: none (loopback only)");
      resolve();
    });
  }).catch((err: unknown) => {
    const e = err as NodeJS.ErrnoException;
    console.error(
      e.code === "EADDRINUSE"
        ? `error: ${host}:${port} is already in use — is another torlnk serve running? Pass --port to pick a different one.`
        : `error: cannot listen on ${host}:${port}: ${e.message ?? String(e)}`,
    );
    releaseInstanceLock("serve");
    process.exit(1);
  });

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      void (async () => {
        // Block new work first: an in-flight /add or /control must not mutate
        // the queue (and lazily re-create the engine's client) after suspend.
        runtime.shuttingDown = true;
        // Let pending async saves land before the sync flush, or an older
        // snapshot could rename itself over the fresher one.
        await runtime.queue.flushPendingWrites();
        server.close();
        runtime.queue.suspend();
        // If we are the recorded --daemon instance, drop its records so a later
        // `torlnk update` never restarts (or signals) a stale pid.
        removeRunDescriptor("serve", process.pid);
        releaseInstanceLock("serve");
        resolve();
      })();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}
