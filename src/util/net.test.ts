import { describe, it, expect } from "vitest";
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
});
