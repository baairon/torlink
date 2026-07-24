import { describe, it, expect } from "vitest";
import {
  setFlareSolverrUrl,
  getFlareSolverrUrl,
  isFlareSolverrEnabled,
  isCloudflareBlock,
} from "./flaresolverr";

function fakeRes(status: number, headers: Record<string, string> = {}): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as Response;
}

describe("flaresolverr module", () => {
  it("defaults to disabled (undefined)", () => {
    setFlareSolverrUrl(undefined);
    expect(getFlareSolverrUrl()).toBeUndefined();
    expect(isFlareSolverrEnabled()).toBe(false);
  });

  it("sets and gets FlareSolverr URL correctly", () => {
    setFlareSolverrUrl("http://localhost:8191/v1");
    expect(getFlareSolverrUrl()).toBe("http://localhost:8191/v1");
    expect(isFlareSolverrEnabled()).toBe(true);

    setFlareSolverrUrl(undefined);
  });

  it("detects Cloudflare 503 and 403 blocks correctly", () => {
    expect(isCloudflareBlock(fakeRes(503, { server: "cloudflare" }))).toBe(true);
    expect(isCloudflareBlock(fakeRes(503, { server: "ddos-guard" }))).toBe(true);
    expect(isCloudflareBlock(fakeRes(403, { server: "cloudflare" }))).toBe(true);
    expect(isCloudflareBlock(fakeRes(200, { server: "cloudflare" }))).toBe(false);
    expect(isCloudflareBlock(fakeRes(404, { server: "nginx" }))).toBe(false);
  });
});
