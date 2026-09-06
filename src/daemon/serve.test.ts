import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  handleApi,
  isAuthorized,
  extractMagnet,
  extractTorrentBytes,
  extractSeedTime,
  parseControl,
  applyControl,
} from "./serve";
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
        getHistory: () => [],
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

  it("forwards a per-torrent seedTime from POST /add", async () => {
    const res = await handleApi(runtime, null, "POST", "/add", undefined, `{"magnet":"${MAGNET}","seedTime":"30d"}`);
    expect(res.status).toBe(200);
    expect(add).toHaveBeenCalledWith(
      { id: HASH, name: "Example", magnet: MAGNET, seedTimeMs: 30 * 86_400_000 },
      dir,
    );
  });

  it("adds without a seedTime when the field is absent (daemon default applies)", async () => {
    await handleApi(runtime, null, "POST", "/add", undefined, `{"magnet":"${MAGNET}"}`);
    const [input] = add.mock.calls[0]!;
    expect("seedTimeMs" in (input as object)).toBe(false);
  });

  it("400s an unusable seedTime on POST /add without adding anything", async () => {
    const res = await handleApi(runtime, null, "POST", "/add", undefined, `{"magnet":"${MAGNET}","seedTime":"soon"}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid seedTime" });
    expect(add).not.toHaveBeenCalled();
  });

  it("sets a seed limit on a known torrent through POST /control", async () => {
    const setSeedTime = vi.fn().mockReturnValue(true);
    runtime.queue = { setSeedTime } as unknown as Runtime["queue"];
    const res = await handleApi(
      runtime,
      null,
      "POST",
      "/control",
      undefined,
      `{"id":"${HASH}","action":"seed-time","seedTime":"2h"}`,
    );
    expect(res.status).toBe(200);
    expect(setSeedTime).toHaveBeenCalledWith(HASH, 2 * 3_600_000);
  });

  it("400s a seed-time control with an unusable value, 404s an unknown torrent", async () => {
    const setSeedTime = vi.fn().mockReturnValue(false);
    runtime.queue = { setSeedTime } as unknown as Runtime["queue"];
    const bad = await handleApi(runtime, null, "POST", "/control", undefined, `{"id":"${HASH}","action":"seed-time","seedTime":"eventually"}`);
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: "invalid seedTime" });
    expect(setSeedTime).not.toHaveBeenCalled();
    const missing = await handleApi(runtime, null, "POST", "/control", undefined, `{"id":"${HASH}","action":"seed-time","seedTime":"1d"}`);
    expect(missing.status).toBe(404);
  });

  it("reports a torrent's own limit and its due time on GET /downloads", async () => {
    const completedAt = 1_700_000_000_000;
    runtime.queue = {
      getItems: () => [
        { id: "dl", name: "In flight", status: "downloading", progress: 0.5, peers: 1, speed: 0, seedTimeMs: 60_000 },
      ],
      getSeeds: () => [
        { id: "own", name: "Own", status: "seeding", peers: 0, uploaded: 0 },
        { id: "forever", name: "Forever", status: "seeding", peers: 0, uploaded: 0 },
        { id: "plain", name: "Plain", status: "seeding", peers: 0, uploaded: 0 },
      ],
      getHistory: () => [
        { id: "own", completedAt, seedTimeMs: 3_600_000 },
        { id: "forever", completedAt, seedTimeMs: 0 },
        { id: "plain", completedAt },
      ],
    } as unknown as Runtime["queue"];
    const res = await handleApi(runtime, null, "GET", "/downloads", undefined, "");
    const body = res.body as { downloads: Record<string, unknown>[]; seeds: Record<string, unknown>[] };
    expect(body.downloads[0]).toMatchObject({ id: "dl", seedTimeMs: 60_000 });
    expect(body.seeds[0]).toMatchObject({ id: "own", seedTimeMs: 3_600_000, seedUntil: completedAt + 3_600_000 });
    expect(body.seeds[1]).toMatchObject({ id: "forever", seedTimeMs: 0, seedUntil: null });
    expect("seedTimeMs" in body.seeds[2]!).toBe(false);
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
  it("parses seedTime into ms, blank clears, garbage is null", () => {
    expect(parseControl(`{"id":"abc","action":"seed-time","seedTime":"1d"}`)?.seedTimeMs).toBe(86_400_000);
    expect(parseControl(`{"id":"abc","action":"seed-time","seedTime":""}`)?.seedTimeMs).toBeUndefined();
    expect(parseControl(`{"id":"abc","action":"seed-time"}`)?.seedTimeMs).toBeUndefined();
    expect(parseControl(`{"id":"abc","action":"seed-time","seedTime":"1 week"}`)?.seedTimeMs).toBeNull();
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

  it("seed-time sets, clears, and refuses an unusable value", async () => {
    const setSeedTime = vi.fn().mockReturnValue(true);
    const rt = mkRuntime({ setSeedTime });
    expect(await applyControl(rt, { id: "s", action: "seed-time", deleteFiles: false, seedTimeMs: 5000 })).toBe("ok");
    expect(setSeedTime).toHaveBeenCalledWith("s", 5000);
    expect(await applyControl(rt, { id: "s", action: "seed-time", deleteFiles: false, seedTimeMs: undefined })).toBe("ok");
    expect(setSeedTime).toHaveBeenLastCalledWith("s", undefined);
    expect(await applyControl(rt, { id: "s", action: "seed-time", deleteFiles: false, seedTimeMs: null })).toBe(
      "invalid-seed-time",
    );
    expect(setSeedTime).toHaveBeenCalledTimes(2);
    setSeedTime.mockReturnValue(false);
    expect(await applyControl(rt, { id: "?", action: "seed-time", deleteFiles: false, seedTimeMs: 1 })).toBe("not-found");
  });

  it("reports not-found when remove finds nothing and unknown-action otherwise", async () => {
    const rt = mkRuntime({ remove: vi.fn().mockResolvedValue(false) });
    expect(await applyControl(rt, { id: "z", action: "remove", deleteFiles: false })).toBe("not-found");
    expect(await applyControl(mkRuntime({}), { id: "z", action: "nope", deleteFiles: false })).toBe("unknown-action");
  });
});

describe("extractTorrentBytes", () => {
  // Every torrent is a bencoded dictionary, so it starts with "d".
  const b64 = Buffer.from("d4:name4:teste", "utf8").toString("base64");

  it("reads a base64 .torrent out of the body", () => {
    const bytes = extractTorrentBytes(JSON.stringify({ torrent: b64 }));
    expect(bytes).not.toBeNull();
    expect(bytes![0]).toBe(0x64);
  });

  // What a browser's FileReader.readAsDataURL hands you, verbatim.
  it("accepts a data: URI without making the caller strip it", () => {
    const uri = `data:application/x-bittorrent;base64,${b64}`;
    expect(extractTorrentBytes(JSON.stringify({ torrent: uri }))).not.toBeNull();
  });

  /*
   * Buffer.from(..., "base64") ignores bytes it cannot decode rather than
   * throwing, so garbage yields a short buffer instead of an error. Checking
   * for the leading bencode dictionary is what turns that into a rejection.
   */
  it("rejects a string that is not a torrent", () => {
    expect(extractTorrentBytes(JSON.stringify({ torrent: "hello world" }))).toBeNull();
    expect(extractTorrentBytes(JSON.stringify({ torrent: "" }))).toBeNull();
  });

  it("is null for a body that carries no torrent at all", () => {
    expect(extractTorrentBytes(JSON.stringify({ magnet: "magnet:?xt=urn:btih:" + "a".repeat(40) }))).toBeNull();
    expect(extractTorrentBytes("not json")).toBeNull();
  });
});

describe("extractSeedTime", () => {
  it("is undefined when the field is absent, blank, or the body is not JSON", () => {
    expect(extractSeedTime(`{"magnet":"m"}`)).toBeUndefined();
    expect(extractSeedTime(`{"magnet":"m","seedTime":""}`)).toBeUndefined();
    expect(extractSeedTime(`{"magnet":"m","seedTime":null}`)).toBeUndefined();
    expect(extractSeedTime("magnet:?xt=urn:btih:abc")).toBeUndefined();
    expect(extractSeedTime("{not json")).toBeUndefined();
  });

  it("reads the --seed-time grammar, a bare number as seconds, and 0 as never", () => {
    expect(extractSeedTime(`{"seedTime":"30d"}`)).toBe(30 * 86_400_000);
    expect(extractSeedTime(`{"seedTime":"90m"}`)).toBe(90 * 60_000);
    expect(extractSeedTime(`{"seedTime":"45"}`)).toBe(45_000);
    expect(extractSeedTime(`{"seedTime":3600}`)).toBe(3_600_000);
    expect(extractSeedTime(`{"seedTime":0}`)).toBe(0);
    expect(extractSeedTime(`{"seedTime":"0"}`)).toBe(0);
  });

  it("is null for anything it cannot read, so the caller can 400", () => {
    expect(extractSeedTime(`{"seedTime":"a month"}`)).toBeNull();
    expect(extractSeedTime(`{"seedTime":"1w"}`)).toBeNull();
    expect(extractSeedTime(`{"seedTime":-5}`)).toBeNull();
    expect(extractSeedTime(`{"seedTime":true}`)).toBeNull();
    expect(extractSeedTime(`{"seedTime":{}}`)).toBeNull();
  });
});
