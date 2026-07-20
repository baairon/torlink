import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { handleApi, isAuthorized, extractMagnet, parseControl, applyControl } from "./serve";
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

  it("400s a .torrent file path (no filesystem reach over HTTP)", async () => {
    const res = await handleApi(runtime, null, "POST", "/add", undefined, "C:/secrets/x.torrent");
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

  it("400s POST /control with a malformed body", async () => {
    const res = await handleApi(runtime, null, "POST", "/control", undefined, `{"id":"x"}`);
    expect(res.status).toBe(400);
  });

  it("400s POST /control with an unknown action", async () => {
    const res = await handleApi(runtime, null, "POST", "/control", undefined, `{"id":"${HASH}","action":"boom"}`);
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("unknown action");
  });

  it("404s POST /control for an unknown torrent", async () => {
    const res = await handleApi(runtime, null, "POST", "/control", undefined, `{"id":"${HASH}","action":"pause"}`);
    expect(res.status).toBe(404);
  });

  it("pauses a known download on POST /control", async () => {
    const pause = vi.fn();
    runtime.queue = { has: (id: string) => id === HASH, pause } as unknown as Runtime["queue"];
    const res = await handleApi(runtime, null, "POST", "/control", undefined, `{"id":"${HASH}","action":"pause"}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, action: "pause" });
    expect(pause).toHaveBeenCalledWith(HASH);
  });
});

describe("parseControl", () => {
  it("reads id + action from JSON", () => {
    expect(parseControl(`{"id":"abc","action":"pause"}`)).toEqual({ id: "abc", action: "pause", deleteFiles: false });
  });
  it("reads the deleteFiles flag", () => {
    expect(parseControl(`{"id":"abc","action":"delete","deleteFiles":true}`)).toEqual({
      id: "abc",
      action: "delete",
      deleteFiles: true,
    });
  });
  it("returns null when id or action is missing/blank or the body isn't JSON", () => {
    expect(parseControl(`{"id":"abc"}`)).toBeNull();
    expect(parseControl(`{"action":"pause"}`)).toBeNull();
    expect(parseControl(`{"id":"  ","action":"pause"}`)).toBeNull();
    expect(parseControl(`pause abc`)).toBeNull();
    expect(parseControl("")).toBeNull();
  });
});

describe("applyControl", () => {
  const mkRuntime = (queue: Partial<Record<string, unknown>>): Runtime =>
    ({ queue: queue as unknown as Runtime["queue"], downloadDir: "/tmp" });

  it("resumes a paused download", async () => {
    const resume = vi.fn();
    const rt = mkRuntime({ has: (id: string) => id === "x", resume });
    expect(await applyControl(rt, { id: "x", action: "resume", deleteFiles: false })).toBe("ok");
    expect(resume).toHaveBeenCalledWith("x");
  });

  it("stops seeding but keeps files", async () => {
    const stopSeeding = vi.fn();
    const rt = mkRuntime({ getSeed: (id: string) => (id === "s" ? { id } : undefined), stopSeeding });
    expect(await applyControl(rt, { id: "s", action: "stop-seed", deleteFiles: false })).toBe("ok");
    expect(stopSeeding).toHaveBeenCalledWith("s");
  });

  it("starts seeding from a history entry", async () => {
    const startSeeding = vi.fn();
    const hist = { id: "h", name: "H", magnet: "m", dir: "/d", sizeBytes: 1, completedAt: 0 };
    const rt = mkRuntime({ getHistory: () => [hist], startSeeding });
    expect(await applyControl(rt, { id: "h", action: "start-seed", deleteFiles: false })).toBe("ok");
    expect(startSeeding).toHaveBeenCalledWith(hist);
  });

  it("delete forces deleteFiles:true; remove keeps files", async () => {
    const remove = vi.fn().mockResolvedValue(true);
    const rt = mkRuntime({ remove });
    expect(await applyControl(rt, { id: "z", action: "delete", deleteFiles: false })).toBe("ok");
    expect(remove).toHaveBeenCalledWith("z", { deleteFiles: true });
    remove.mockClear();
    await applyControl(rt, { id: "z", action: "remove", deleteFiles: false });
    expect(remove).toHaveBeenCalledWith("z", { deleteFiles: false });
  });

  it("reports not-found when remove finds nothing and unknown-action otherwise", async () => {
    const rt = mkRuntime({ remove: vi.fn().mockResolvedValue(false) });
    expect(await applyControl(rt, { id: "z", action: "remove", deleteFiles: false })).toBe("not-found");
    expect(await applyControl(mkRuntime({}), { id: "z", action: "nope", deleteFiles: false })).toBe("unknown-action");
  });
});
