import { describe, it, expect } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import type { Socket } from "node:net";
import { parseRetryAfter, backoffDelay, fetchResilient, HttpError } from "./net";

function fakeRes(status: number, headers: Record<string, string> = {}): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as Response;
}

describe("parseRetryAfter", () => {
  it("parses delta-seconds and rejects garbage", () => {
    expect(parseRetryAfter("5")).toBe(5000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("soon")).toBeUndefined();
  });
  it("parses an HTTP date relative to now", () => {
    const future = new Date(Date.now() + 10_000).toUTCString();
    const ms = parseRetryAfter(future);
    expect(ms).toBeGreaterThan(5_000);
    expect(ms).toBeLessThanOrEqual(10_000);
  });
});

describe("backoffDelay", () => {
  it("applies jitter and honors retry-after as a floor", () => {
    expect(backoffDelay(0, 500, 20000, undefined, () => 0.5)).toBe(250);
    expect(backoffDelay(2, 500, 20000, undefined, () => 0)).toBe(0);
    expect(backoffDelay(0, 500, 20000, 1000, () => 0.5)).toBe(1000);
  });
});

describe("fetchResilient", () => {
  const opts = { sleepImpl: async () => {}, baseMs: 1, capMs: 1 };

  it.each([200, 404])("cancels discarded responses before backoff and leaves HTTP %i readable", async (status) => {
    let cancelled = false;
    const discarded = new Response(new ReadableStream({
      cancel() { cancelled = true; },
    }), { status: 503 });
    let calls = 0;
    const result = await fetchResilient("http://x", {
      retries: 1,
      fetchImpl: async () => ++calls === 1 ? discarded : new Response("success", { status }),
      sleepImpl: async () => { expect(cancelled).toBe(true); },
    });
    expect(cancelled).toBe(true);
    expect(await result.text()).toBe("success");
  });

  it.each([
    { status: 503, headers: {}, retries: 0 },
    { status: 503, headers: { server: "cloudflare" }, retries: 3 },
    { status: 503, headers: { server: "ddos-guard" }, retries: 3 },
    { status: 429, headers: { "retry-after": "86400" }, retries: 3 },
  ])("cancels discarded bodies when rejecting HTTP $status ($headers)", async ({ status, headers, retries }) => {
    let cancelled = false;
    const response = new Response(new ReadableStream({
      cancel() { cancelled = true; },
    }), { status, headers });
    await expect(fetchResilient("http://x", {
      retries,
      fetchImpl: async () => response,
    })).rejects.toMatchObject({ name: "HttpError", status });
    expect(cancelled).toBe(true);
  });

  it("keeps retry and HTTP error handling when body cancellation rejects", async () => {
    let calls = 0;
    await expect(fetchResilient("http://x", {
      retries: 1,
      sleepImpl: async () => {},
      fetchImpl: async () => {
        calls++;
        return new Response(new ReadableStream({
          cancel() { throw new Error("cleanup failed"); },
        }), { status: 503 });
      },
    })).rejects.toMatchObject({ name: "HttpError", status: 503 });
    expect(calls).toBe(2);
  });

  it("handles a retryable response with no body", async () => {
    await expect(fetchResilient("http://x", {
      retries: 0,
      fetchImpl: async () => new Response(null, { status: 503 }),
    })).rejects.toMatchObject({ name: "HttpError", status: 503 });
  });

  it("releases streaming error responses across repeated requests", async () => {
    const sockets = new Set<Socket>();
    let openResponses = 0;
    const server = createServer((_req, res) => {
      openResponses++;
      res.on("close", () => { openResponses--; });
      res.writeHead(503);
      // Deliberately never end the body: the caller must cancel it.
      res.write(Buffer.alloc(64 * 1024));
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing TCP port");
    try {
      for (let i = 0; i < 5; i++) {
        await expect(fetchResilient(`http://127.0.0.1:${address.port}`, {
          retries: 2,
          sleepImpl: async () => {},
        })).rejects.toMatchObject({ name: "HttpError", status: 503 });
      }
      await expect.poll(() => openResponses, { timeout: 1000 }).toBe(0);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it("retries a 503 then returns the success response", async () => {
    let calls = 0;
    const res = await fetchResilient("http://x", {
      ...opts,
      retries: 3,
      fetchImpl: async () => (++calls === 1 ? fakeRes(503) : fakeRes(200)),
    });
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("throws after exhausting retries", async () => {
    await expect(
      fetchResilient("http://x", { ...opts, retries: 2, fetchImpl: async () => fakeRes(503) }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it("throws immediately when the signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      fetchResilient("http://x", { ...opts, signal: ctrl.signal, fetchImpl: async () => fakeRes(200) }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it("does not retry a non-retryable status", async () => {
    let calls = 0;
    const res = await fetchResilient("http://x", {
      ...opts,
      fetchImpl: async () => (++calls, fakeRes(404)),
    });
    expect(res.status).toBe(404);
    expect(calls).toBe(1);
  });

  it("passes the abort signal to the sleep implementation", async () => {
    const ctrl = new AbortController();
    const seen: (AbortSignal | undefined)[] = [];
    await expect(
      fetchResilient("http://x", {
        retries: 1,
        baseMs: 1,
        capMs: 1,
        signal: ctrl.signal,
        sleepImpl: async (_ms, signal) => {
          seen.push(signal);
        },
        fetchImpl: async () => fakeRes(503),
      }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(seen).toEqual([ctrl.signal]);
  });

  // A source that went invite-only answered 503 with Retry-After: 86400, and
  // waiting that out held its search for a day.
  it("fails at once when Retry-After asks for longer than the backoff cap", async () => {
    let calls = 0;
    const slept: number[] = [];
    const attempt = fetchResilient("http://x", {
      retries: 3,
      baseMs: 500,
      capMs: 20_000,
      sleepImpl: async (ms) => {
        slept.push(ms);
      },
      fetchImpl: async () => (++calls, fakeRes(503, { "retry-after": "86400" })),
    });
    await expect(attempt).rejects.toMatchObject({
      name: "HttpError",
      status: 503,
      message: "Request to http://x was told to retry in 86400s (HTTP 503).",
    });
    expect(calls).toBe(1);
    expect(slept).toEqual([]);
  });

  it("still waits out a Retry-After within the backoff cap", async () => {
    let calls = 0;
    const slept: number[] = [];
    const res = await fetchResilient("http://x", {
      retries: 3,
      baseMs: 500,
      capMs: 20_000,
      sleepImpl: async (ms) => {
        slept.push(ms);
      },
      fetchImpl: async () => (++calls === 1 ? fakeRes(429, { "retry-after": "20" }) : fakeRes(200)),
    });
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
    expect(slept).toEqual([20_000]);
  });

  it("cuts a backoff sleep short when the signal aborts", async () => {
    // No sleepImpl: exercises the real sleep. Retry-After floors the backoff
    // at 60s, so only an abort-aware sleep lets this settle quickly.
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 20);
    const started = Date.now();
    await expect(
      fetchResilient("http://x", {
        retries: 2,
        baseMs: 60_000,
        capMs: 60_000,
        signal: ctrl.signal,
        fetchImpl: async () => fakeRes(503, { "retry-after": "60" }),
      }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
