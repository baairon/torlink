import { EventEmitter } from "node:events";
import { describe, it, expect, vi, afterEach } from "vitest";

const constructorCalls: Record<string, unknown>[] = [];

vi.mock("webtorrent", () => {
  return {
    default: class extends EventEmitter {
      torrentPort = 6881;
      constructor(opts?: Record<string, unknown>) {
        super();
        constructorCalls.push(opts ?? {});
      }
      add(): EventEmitter {
        const t = new EventEmitter() as EventEmitter & { destroyed: boolean; destroy: () => void };
        t.destroyed = false;
        t.destroy = () => { t.destroyed = true; };
        return t;
      }
      destroy(): void {}
    },
  };
});

// Default: parseTorrent resolves with a valid infoHash so ordinary tests are unaffected.
vi.mock("parse-torrent", () => ({
  default: vi.fn().mockResolvedValue({ infoHash: "aabbccddeeff00112233445566778899aabbccdd" }),
}));

afterEach(() => {
  constructorCalls.length = 0;
  vi.resetModules();
});

describe("TorrentEngine macOS port-5350 fix (#22)", () => {
  it("passes natPmp:false on macOS so mDNSResponder's port 5350 is never bound", async () => {
    const { TorrentEngine } = await import("./engine");
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });
    try {
      const engine = new TorrentEngine();
      engine.add(
        "test-id",
        "magnet:?xt=urn:btih:0000000000000000000000000000000000000000",
        "/downloads",
        {},
      );
      engine.destroy();
    } finally {
      Object.defineProperty(process, "platform", { value: original });
    }
    expect(constructorCalls).toHaveLength(1);
    expect(constructorCalls[0]).toMatchObject({ natPmp: false });
  });

  it("does not disable natPmp on Linux (port 5350 is free)", async () => {
    const { TorrentEngine } = await import("./engine");
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "linux" });
    try {
      const engine = new TorrentEngine();
      engine.add(
        "test-id",
        "magnet:?xt=urn:btih:0000000000000000000000000000000000000000",
        "/downloads",
        {},
      );
      engine.destroy();
    } finally {
      Object.defineProperty(process, "platform", { value: original });
    }
    expect(constructorCalls).toHaveLength(1);
    expect(constructorCalls[0]).not.toHaveProperty("natPmp", false);
  });

  it("does not disable natPmp on Windows (port 5350 is free)", async () => {
    const { TorrentEngine } = await import("./engine");
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      const engine = new TorrentEngine();
      engine.add(
        "test-id",
        "magnet:?xt=urn:btih:0000000000000000000000000000000000000000",
        "/downloads",
        {},
      );
      engine.destroy();
    } finally {
      Object.defineProperty(process, "platform", { value: original });
    }
    expect(constructorCalls).toHaveLength(1);
    expect(constructorCalls[0]).not.toHaveProperty("natPmp", false);
  });

  it("stats(id) ignores getter errors and returns safe defaults", async () => {
    const { TorrentEngine } = await import("./engine");
    const engine = new TorrentEngine();
    const fakeTorrent = new EventEmitter();
    Object.defineProperty(fakeTorrent, "progress", {
      get() {
        throw new Error("Metadata not ready");
      },
    });
    Object.defineProperty(fakeTorrent, "length", {
      get() {
        throw new Error("Metadata not ready");
      },
    });
    // Inject fakeTorrent directly into private torrents map
    (engine as unknown as { torrents: Map<string, unknown> }).torrents.set("bad-id", fakeTorrent);

    const result = engine.stats("bad-id");
    expect(result).not.toBeNull();
    expect(result?.progress).toBe(0);
    expect(result?.total).toBe(0);
    engine.destroy();
  });
});

describe("TorrentEngine infoHash pre-validation guard (#110)", () => {
  it("calls onError and removes the torrent when parseTorrent resolves with infoHash undefined", async () => {
    // Override parse-torrent to return a truthy object with no infoHash — the
    // exact condition that makes webtorrent crash inside _onTorrentId.
    const parseTorrentMod = await import("parse-torrent");
    vi.mocked(parseTorrentMod.default).mockResolvedValueOnce({ infoHash: undefined });

    const { TorrentEngine } = await import("./engine");
    const engine = new TorrentEngine();

    const errors: string[] = [];
    engine.add(
      "bad-id",
      "magnet:?xt=urn:btih:0000000000000000000000000000000000000000",
      "/downloads",
      { onError: (msg) => errors.push(msg) },
    );

    // parseTorrent is async — flush microtask queue so the .then() runs.
    await new Promise((r) => setTimeout(r, 0));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("infoHash could not be resolved");
    // Torrent must have been removed from the internal map.
    const torrents = (engine as unknown as { torrents: Map<string, unknown> }).torrents;
    expect(torrents.has("bad-id")).toBe(false);
    engine.destroy();
  });

  it("calls onError and removes the torrent when parseTorrent rejects", async () => {
    const parseTorrentMod = await import("parse-torrent");
    vi.mocked(parseTorrentMod.default).mockRejectedValueOnce(new Error("parse failed"));

    const { TorrentEngine } = await import("./engine");
    const engine = new TorrentEngine();

    const errors: string[] = [];
    engine.add(
      "bad-id",
      "magnet:?xt=urn:btih:0000000000000000000000000000000000000000",
      "/downloads",
      { onError: (msg) => errors.push(msg) },
    );

    await new Promise((r) => setTimeout(r, 0));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("parse failed");
    const torrents = (engine as unknown as { torrents: Map<string, unknown> }).torrents;
    expect(torrents.has("bad-id")).toBe(false);
    engine.destroy();
  });

  it("does not delete a newer torrent added for the same id before parseTorrent() settles", async () => {
    // Simulate the race: first parseTorrent call is slow (resolves with no
    // infoHash); by the time it settles, add() has been called again for the
    // same id and a fresh torrent now occupies the slot.
    let resolveFirst!: (v: { infoHash?: string }) => void;
    const firstCall = new Promise<{ infoHash?: string }>((res) => { resolveFirst = res; });
    const parseTorrentMod = await import("parse-torrent");
    vi.mocked(parseTorrentMod.default)
      .mockReturnValueOnce(firstCall as Promise<{ infoHash: string }>)
      .mockResolvedValueOnce({ infoHash: "aabbccddeeff00112233445566778899aabbccdd" });

    const { TorrentEngine } = await import("./engine");
    const engine = new TorrentEngine();
    const torrents = (engine as unknown as { torrents: Map<string, unknown> }).torrents;

    // First add — parseTorrent is pending.
    engine.add("id1", "magnet:?xt=urn:btih:0000000000000000000000000000000000000000", "/d", {});
    // Second add for same id — replaces map entry synchronously.
    engine.add("id1", "magnet:?xt=urn:btih:0000000000000000000000000000000000000000", "/d", {});

    // Capture reference to the new (second) torrent BEFORE settling the first.
    const newTorrent = torrents.get("id1");
    expect(newTorrent).toBeDefined();

    // Now settle first parseTorrent with missing infoHash.
    resolveFirst({ infoHash: undefined });
    await new Promise((r) => setTimeout(r, 0));

    // The stale validator must NOT have wiped the new torrent's map entry.
    expect(torrents.get("id1")).toBe(newTorrent);
    engine.destroy();
  });
});
