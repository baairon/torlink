import { describe, it, expect, vi } from "vitest";
import { sendMagnet } from "./client";
import type { DelugeConfig } from "../config/config";

const config: DelugeConfig = { url: "http://localhost:8112", password: "secret" };
const MAGNET = "magnet:?xt=urn:btih:abc";

function fakeRes(body: unknown, headers: Record<string, string> = {}, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as Response;
}

describe("sendMagnet", () => {
  it("returns not-configured without calling fetch when there is no config", async () => {
    const fetchImpl = vi.fn();
    const result = await sendMagnet(null, MAGNET, { fetchImpl });
    expect(result).toEqual({ ok: false, reason: "not-configured", message: expect.any(String) });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("logs in then adds the magnet, forwarding the session cookie", async () => {
    const calls: (RequestInit | undefined)[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(init);
      if (calls.length === 1) {
        return fakeRes({ result: true }, { "set-cookie": "_session_id=abc123; Path=/" });
      }
      return fakeRes({ result: "deadbeef" });
    });

    const result = await sendMagnet(config, MAGNET, { fetchImpl });

    expect(result).toEqual({ ok: true, status: "added" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondHeaders = calls[1]!.headers as Record<string, string>;
    expect(secondHeaders.Cookie).toContain("_session_id=abc123");
  });

  it("returns already-added when Deluge reports a duplicate", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeRes({ result: true }))
      .mockResolvedValueOnce(
        fakeRes({ error: { message: "Torrent already in session (deadbeef)." } }),
      );

    const result = await sendMagnet(config, MAGNET, { fetchImpl });

    expect(result).toEqual({ ok: true, status: "already-added" });
  });

  it("returns auth-failed when login does not succeed", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(fakeRes({ result: false }));

    const result = await sendMagnet(config, MAGNET, { fetchImpl });

    expect(result).toEqual({ ok: false, reason: "auth-failed", message: expect.any(String) });
  });

  it("returns unreachable when the request throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("fetch failed"));

    const result = await sendMagnet(config, MAGNET, { fetchImpl });

    expect(result).toEqual({ ok: false, reason: "unreachable", message: expect.any(String) });
  });

  it("returns error with Deluge's message for any other add failure", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeRes({ result: true }))
      .mockResolvedValueOnce(fakeRes({ error: { message: "Invalid torrent" } }));

    const result = await sendMagnet(config, MAGNET, { fetchImpl });

    expect(result).toEqual({ ok: false, reason: "error", message: "Invalid torrent" });
  });
});
