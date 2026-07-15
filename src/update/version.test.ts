import { describe, it, expect } from "vitest";
import { compareVersions, isNewer, fetchLatestVersion } from "./version";

describe("compareVersions", () => {
  it("orders by major, minor, then patch", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBeLessThan(0);
    expect(compareVersions("1.2.0", "1.1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.4.1", "1.4.0")).toBeGreaterThan(0);
    expect(compareVersions("1.4.1", "1.4.1")).toBe(0);
  });
  it("tolerates a leading v and uneven lengths", () => {
    expect(compareVersions("v1.4", "1.4.0")).toBe(0);
    expect(compareVersions("1.4.1", "1.4")).toBeGreaterThan(0);
  });
  it("ignores pre-release and build suffixes", () => {
    expect(compareVersions("1.4.1-rc.2", "1.4.1")).toBe(0);
    expect(compareVersions("1.5.0+build9", "1.4.9")).toBeGreaterThan(0);
  });
});

describe("isNewer", () => {
  it("is true only when the candidate is ahead of current", () => {
    expect(isNewer("1.4.0", "1.4.1")).toBe(true);
    expect(isNewer("1.4.1", "1.4.1")).toBe(false);
    expect(isNewer("1.4.1", "1.4.0")).toBe(false);
  });
});

describe("fetchLatestVersion", () => {
  const okResponse = (version: unknown): Response =>
    ({ ok: true, json: async () => ({ version }) }) as unknown as Response;

  it("returns the version string from the registry", async () => {
    const v = await fetchLatestVersion({ fetchImpl: async () => okResponse("1.5.0") });
    expect(v).toBe("1.5.0");
  });
  it("returns null on a non-ok response", async () => {
    const v = await fetchLatestVersion({
      fetchImpl: async () => ({ ok: false, status: 404 }) as unknown as Response,
    });
    expect(v).toBeNull();
  });
  it("returns null when the network throws", async () => {
    const v = await fetchLatestVersion({
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    expect(v).toBeNull();
  });
  it("returns null when the payload has no version", async () => {
    const v = await fetchLatestVersion({ fetchImpl: async () => okResponse(undefined) });
    expect(v).toBeNull();
  });
});
