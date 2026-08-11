import { EventEmitter } from "node:events";
import { describe, it, expect, vi, afterEach } from "vitest";

const constructorCalls: Record<string, unknown>[] = [];
const throttleCalls: { down: number[]; up: number[] } = { down: [], up: [] };

vi.mock("webtorrent", () => {
  return {
    default: class extends EventEmitter {
      torrentPort = 6881;
      constructor(opts?: Record<string, unknown>) {
        super();
        constructorCalls.push(opts ?? {});
      }
      add(): EventEmitter {
        return new EventEmitter();
      }
      throttleDownload(rate: number): void {
        throttleCalls.down.push(rate);
      }
      throttleUpload(rate: number): void {
        throttleCalls.up.push(rate);
      }
      destroy(): void {}
    },
  };
});

afterEach(() => {
  constructorCalls.length = 0;
  throttleCalls.down.length = 0;
  throttleCalls.up.length = 0;
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

describe("TorrentEngine speed limits", () => {
  const MAGNET = "magnet:?xt=urn:btih:0000000000000000000000000000000000000000";

  it("hands a limit set before the first torrent to the client's constructor", async () => {
    const { TorrentEngine } = await import("./engine");
    const engine = new TorrentEngine();
    // The client is built lazily, on the first add: a limit set at launch has
    // to survive until then, or the first torrent starts unthrottled.
    engine.setSpeedLimits(1024 * 1024, 256 * 1024);
    engine.add("test-id", MAGNET, "/downloads", {});
    engine.destroy();
    expect(constructorCalls).toHaveLength(1);
    expect(constructorCalls[0]).toMatchObject({
      downloadLimit: 1024 * 1024,
      uploadLimit: 256 * 1024,
    });
  });

  it("spells unlimited as -1, webtorrent's own sentinel", async () => {
    const { TorrentEngine } = await import("./engine");
    const engine = new TorrentEngine();
    engine.add("test-id", MAGNET, "/downloads", {});
    engine.destroy();
    expect(constructorCalls[0]).toMatchObject({ downloadLimit: -1, uploadLimit: -1 });
  });

  it("applies a tightened limit to the live client, not just the next one", async () => {
    const { TorrentEngine } = await import("./engine");
    const engine = new TorrentEngine();
    engine.add("test-id", MAGNET, "/downloads", {});
    engine.setSpeedLimits(512 * 1024, 0);
    engine.destroy();
    expect(throttleCalls.down).toEqual([512 * 1024]);
    expect(throttleCalls.up).toEqual([-1]);
  });

  it("keeps the limit across a client rebuild after destroy()", async () => {
    const { TorrentEngine } = await import("./engine");
    const engine = new TorrentEngine();
    engine.setSpeedLimits(2 * 1024 * 1024, 0);
    engine.add("test-id", MAGNET, "/downloads", {});
    engine.destroy();
    engine.add("second-id", MAGNET, "/downloads", {});
    engine.destroy();
    expect(constructorCalls).toHaveLength(2);
    expect(constructorCalls[1]).toMatchObject({ downloadLimit: 2 * 1024 * 1024 });
  });

  it("survives a client that cannot throttle — a limit is never fatal", async () => {
    const { TorrentEngine } = await import("./engine");
    const engine = new TorrentEngine();
    engine.add("test-id", MAGNET, "/downloads", {});
    const client = (engine as unknown as { client: Record<string, unknown> }).client;
    client.throttleDownload = () => {
      throw new Error("not supported");
    };
    expect(() => engine.setSpeedLimits(1024, 1024)).not.toThrow();
    engine.destroy();
  });
});
