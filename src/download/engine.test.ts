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
        return new EventEmitter();
      }
      destroy(): void {}
    },
  };
});

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

describe("TorrentEngine uTP opt-out (TORLINK_NO_UTP)", () => {
  it("leaves uTP on by default, the way other BitTorrent clients ship it", async () => {
    const { TorrentEngine } = await import("./engine");
    const original = process.env.TORLINK_NO_UTP;
    delete process.env.TORLINK_NO_UTP;
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
      if (original === undefined) delete process.env.TORLINK_NO_UTP;
      else process.env.TORLINK_NO_UTP = original;
    }
    expect(constructorCalls).toHaveLength(1);
    expect(constructorCalls[0]).not.toHaveProperty("utp", false);
  });

  it("passes utp:false when TORLINK_NO_UTP is set, so utp-native cannot exhaust sockets", async () => {
    const { TorrentEngine } = await import("./engine");
    const original = process.env.TORLINK_NO_UTP;
    process.env.TORLINK_NO_UTP = "1";
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
      if (original === undefined) delete process.env.TORLINK_NO_UTP;
      else process.env.TORLINK_NO_UTP = original;
    }
    expect(constructorCalls).toHaveLength(1);
    expect(constructorCalls[0]).toMatchObject({ utp: false });
  });
});
