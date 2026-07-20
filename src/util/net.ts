export const USER_AGENT = "torlink (+https://www.npmjs.com/package/torlnk)";

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;
export type SleepImpl = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface FetchResilientOptions extends RequestInit {
  retries?: number;
  baseMs?: number;
  capMs?: number;
  timeoutMs?: number;
  fetchImpl?: FetchImpl;
  sleepImpl?: SleepImpl;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = "HttpError";
    this.status = status;
  }
}

export const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const DEFAULT_RETRIES = 5;
const DEFAULT_BASE_MS = 500;
const DEFAULT_CAP_MS = 20000;
const DEFAULT_TIMEOUT_MS = 15_000;

export function abortError(): Error {
  const e = new Error("The operation was aborted");
  e.name = "AbortError";
  return e;
}

export async function readBodyText(
  res: Response,
  maxBytes = 8 * 1024 * 1024,
): Promise<string> {
  const ab = await res.arrayBuffer();
  if (ab.byteLength > maxBytes) {
    throw new HttpError(0, `response body too large (>${maxBytes} bytes)`);
  }
  return new TextDecoder().decode(ab);
}

// Resolves early on abort so a cancelled search never sits out a backoff wait;
// the retry loop re-checks the signal and bails right after.
function realSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    if (signal) {
      if (signal.aborted) {
        done();
        return;
      }
      signal.addEventListener("abort", done, { once: true });
    }
  });
}

function isAbortError(e: unknown): boolean {
  return (
    e instanceof Error &&
    (e.name === "AbortError" || /aborted/i.test(e.message))
  );
}

export function parseRetryAfter(
  value: string | null,
  nowMs = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, date - nowMs);
  return undefined;
}

export function backoffDelay(
  attempt: number,
  baseMs: number,
  capMs: number,
  retryAfterMs?: number,
  rand: () => number = Math.random,
): number {
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  const jittered = Math.floor(rand() * exp);
  if (retryAfterMs !== undefined) return Math.max(jittered, Math.min(retryAfterMs, capMs));
  return jittered;
}

export async function fetchResilient(
  url: string,
  opts: FetchResilientOptions = {},
): Promise<Response> {
  const {
    retries = DEFAULT_RETRIES,
    baseMs = DEFAULT_BASE_MS,
    capMs = DEFAULT_CAP_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch as FetchImpl,
    sleepImpl = realSleep,
    signal,
    ...init
  } = opts;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw abortError();

    // Per-attempt timeout so a black-holed connection can't hang forever.
    const timeout = AbortSignal.timeout(timeoutMs);
    const attemptSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let res: Response | undefined;
    try {
      res = await fetchImpl(url, { ...init, signal: attemptSignal });
    } catch (e) {
      // User-initiated abort: always propagate immediately.
      if (signal?.aborted) throw e;
      // Timeout or other transient error: retryable.
      lastError = e;
      if (attempt < retries) {
        await sleepImpl(backoffDelay(attempt, baseMs, capMs), signal ?? undefined);
        continue;
      }
      throw e;
    }

    if (!RETRY_STATUS.has(res.status)) return res;

    const server = res.headers.get("server")?.toLowerCase() || "";
    if (res.status === 503 && (server.includes("ddos-guard") || server.includes("cloudflare"))) {
      throw new HttpError(
        res.status,
        `Request to ${url} blocked by ${server} (HTTP ${res.status}).`,
      );
    }

    if (attempt >= retries) {
      throw new HttpError(
        res.status,
        `Request to ${url} failed after ${retries} retries (HTTP ${res.status}).`,
      );
    }

    // Drain leftover body so the underlying socket can be reused.
    try { await res.body?.cancel(); } catch { /* ignore */ }

    const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
    await sleepImpl(backoffDelay(attempt, baseMs, capMs, retryAfterMs), signal ?? undefined);
  }

  throw lastError instanceof Error
    ? lastError
    : new HttpError(0, "fetchResilient exhausted without a response");
}
