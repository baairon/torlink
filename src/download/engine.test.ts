import { EventEmitter } from "node:events";
import { describe, it, expect, vi, afterEach } from "vitest";

const constructorCalls: Record<string, unknown>[] = [];
const clients: EventEmitter[] = [];

vi.mock("webtorrent", () => {
  return {
    default: class extends EventEmitter {
      torrentPort = 6881;
      constructor(opts?: Record<string, unknown>) {
        super();
        constructorCalls.push(opts ?? {});
        clients.push(this);
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
  clients.length = 0;
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
});

describe("TorrentEngine client-level error recovery", () => {
  const MAGNET = "magnet:?xt=urn:btih:0000000000000000000000000000000000000000";

  it("reports the failure on every tracked torrent instead of freezing", async () => {
    const { TorrentEngine } = await import("./engine");
    const engine = new TorrentEngine();
    const errors: string[] = [];
    engine.add("a", MAGNET, "/downloads", { onError: (m) => errors.push(m) });
    engine.add("b", MAGNET, "/downloads", { onError: (m) => errors.push(m) });

    clients[0]!.emit("error", new Error("dht socket blew up"));

    expect(errors).toEqual(["dht socket blew up", "dht socket blew up"]);
    // Dead torrents are forgotten: stats no longer report frozen progress.
    expect(engine.stats("a")).toBeNull();
    expect(engine.stats("b")).toBeNull();
    engine.destroy();
  });

  it("lazily builds a fresh client on the next add() after a fatal error", async () => {
    const { TorrentEngine } = await import("./engine");
    const engine = new TorrentEngine();
    const onError = vi.fn();
    engine.add("a", MAGNET, "/downloads", { onError });
    expect(clients).toHaveLength(1);

    clients[0]!.emit("error", new Error("boom"));
    expect(onError).toHaveBeenCalledTimes(1);

    // Recovery: a new add must not touch the destroyed client.
    engine.add("b", MAGNET, "/downloads", {});
    expect(clients).toHaveLength(2);
    engine.destroy();
  });

  it("ignores an error from a stale client that was already replaced", async () => {
    const { TorrentEngine } = await import("./engine");
    const engine = new TorrentEngine();
    const onError = vi.fn();
    engine.add("a", MAGNET, "/downloads", { onError });
    const stale = clients[0]!;
    stale.emit("error", new Error("first"));
    engine.add("b", MAGNET, "/downloads", { onError });

    onError.mockClear();
    stale.emit("error", new Error("late duplicate"));

    // The replacement torrent must survive the stale client's late error.
    expect(onError).not.toHaveBeenCalled();
    expect(engine.stats("b")).not.toBeNull();
    engine.destroy();
  });
});
