import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { handleApi, isAuthorized, extractMagnet } from "./serve";
import type { Runtime } from "./runtime";

const HASH = "abcdef0123456789abcdef0123456789abcdef01";
const MAGNET = `magnet:?xt=urn:btih:${HASH}&dn=Example`;

describe("isAuthorized", () => {
  it("is open when no token is configured", () => {
    expect(isAuthorized(null, undefined)).toBe(true);
  });
  it("accepts a matching bearer token or raw token", () => {
    expect(isAuthorized("s3cret", "Bearer s3cret")).toBe(true);
    expect(isAuthorized("s3cret", "s3cret")).toBe(true);
  });
  it("rejects a missing or wrong token", () => {
    expect(isAuthorized("s3cret", undefined)).toBe(false);
    expect(isAuthorized("s3cret", "Bearer nope")).toBe(false);
  });
});

describe("extractMagnet", () => {
  it("reads a magnet from JSON", () => {
    expect(extractMagnet(`{"magnet":"${MAGNET}"}`)).toBe(MAGNET);
  });
  it("reads an infohash field", () => {
    expect(extractMagnet(`{"infohash":"${HASH}"}`)).toBe(HASH);
  });
  it("accepts a raw magnet body", () => {
    expect(extractMagnet(MAGNET)).toBe(MAGNET);
  });
  it("returns null for empty or unusable bodies", () => {
    expect(extractMagnet("")).toBeNull();
    expect(extractMagnet("{bad json")).toBeNull();
    expect(extractMagnet(`{"other":1}`)).toBeNull();
  });
});

describe("handleApi", () => {
  let dir: string;
  let add: ReturnType<typeof vi.fn>;
  let runtime: Runtime;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-serve-"));
    add = vi.fn();
    runtime = {
      queue: {
        has: () => false,
        add,
        getItems: () => [],
        getSeeds: () => [],
      } as unknown as Runtime["queue"],
      downloadDir: dir,
    };
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("serves /health without auth", async () => {
    const res = await handleApi(runtime, "tok", "GET", "/health", undefined, "");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("401s a protected route without a token", async () => {
    const res = await handleApi(runtime, "tok", "POST", "/add", undefined, `{"magnet":"${MAGNET}"}`);
    expect(res.status).toBe(401);
    expect(add).not.toHaveBeenCalled();
  });

  it("adds a magnet on POST /add", async () => {
    const res = await handleApi(runtime, "tok", "POST", "/add", "Bearer tok", `{"magnet":"${MAGNET}"}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, outcome: "added" });
    expect(add).toHaveBeenCalledWith({ id: HASH, name: "Example", magnet: MAGNET }, dir);
  });

  it("400s an invalid magnet", async () => {
    const res = await handleApi(runtime, null, "POST", "/add", undefined, `{"magnet":"nope"}`);
    expect(res.status).toBe(400);
    expect(add).not.toHaveBeenCalled();
  });

  it("lists downloads on GET /downloads", async () => {
    const res = await handleApi(runtime, null, "GET", "/downloads", undefined, "");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ downloads: [], seeds: [] });
  });

  it("404s an unknown route", async () => {
    const res = await handleApi(runtime, null, "GET", "/nope", undefined, "");
    expect(res.status).toBe(404);
  });
});
