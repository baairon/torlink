import { EventEmitter } from "node:events";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { InterfaceTable } from "../util/bind";
import { uninstallBindShim } from "../util/bind";

const constructorCalls: Record<string, unknown>[] = [];
const clients: FakeClient[] = [];

let failConstruct = false;

class FakeClient extends EventEmitter {
  torrentPort = 6881;
  listening = false;
  destroyed = false;
  on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }
  added: string[] = [];
  constructor(opts?: Record<string, unknown>) {
    super();
    if (failConstruct) throw new Error("no native module");
    constructorCalls.push(opts ?? {});
    clients.push(this);
  }
  add(source: string): EventEmitter {
    this.added.push(source);
    return Object.assign(new EventEmitter(), { wires: [] as { type: string }[] });
  }
  destroy(cb?: () => void): void {
    this.destroyed = true;
    cb?.();
  }
}

vi.mock("webtorrent", () => ({ default: FakeClient }));

afterEach(() => {
  constructorCalls.length = 0;
  clients.length = 0;
  failConstruct = false;
  uninstallBindShim();
  vi.useRealTimers();
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

describe("TorrentEngine.filePaths", () => {
  it("lists a torrent's file paths, and nothing for an unknown id", async () => {
    const { TorrentEngine } = await import("./engine");
    const engine = new TorrentEngine();
    const fakeTorrent = Object.assign(new EventEmitter(), {
      files: [{ path: "Course/1.mp4" }, { path: "Course/2.mp4" }],
    });
    (engine as unknown as { torrents: Map<string, unknown> }).torrents.set("course", fakeTorrent);

    expect(engine.filePaths("course")).toEqual(["Course/1.mp4", "Course/2.mp4"]);
    expect(engine.filePaths("missing")).toEqual([]);
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

describe("TorrentEngine ready handler", () => {
  it("calls onReady once webtorrent has checked the pieces on disk", async () => {
    const { TorrentEngine } = await import("./engine");
    const engine = new TorrentEngine();
    const onReady = vi.fn();
    engine.add(
      "test-id",
      "magnet:?xt=urn:btih:0000000000000000000000000000000000000000",
      "/downloads",
      { onReady },
    );
    // The queue starts a restored seed's missing-file watch from this, so a
    // dropped listener would leave those seeds unwatched.
    const torrent = (engine as unknown as { torrents: Map<string, EventEmitter> }).torrents.get("test-id");
    expect(onReady).not.toHaveBeenCalled();
    torrent?.emit("ready");
    expect(onReady).toHaveBeenCalledTimes(1);
    engine.destroy();
  });
});

function table(entries: Record<string, string>): InterfaceTable {
  const t: InterfaceTable = {};
  for (const [name, address] of Object.entries(entries)) {
    t[name] = [{ address, netmask: "255.255.255.0", family: "IPv4", mac: "0", internal: false, cidr: `${address}/24` }];
  }
  return t;
}

const MAGNET = "magnet:?xt=urn:btih:0000000000000000000000000000000000000000";
const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};
const RESUME_SETTLE_MS = 3000;

describe("TorrentEngine fixed ports (#164)", () => {
  it("passes --peer-port and --dht-port through as torrentPort and dhtPort", async () => {
    const { TorrentEngine } = await import("./engine");
    const engine = new TorrentEngine({ peerPort: 51413, dhtPort: 6881 });
    engine.add("test-id", MAGNET, "/downloads", {});
    engine.destroy();
    expect(constructorCalls[0]).toMatchObject({ torrentPort: 51413, dhtPort: 6881 });
  });

  it("leaves the ports to webtorrent when none are given", async () => {
    const { TorrentEngine } = await import("./engine");
    const engine = new TorrentEngine();
    engine.add("test-id", MAGNET, "/downloads", {});
    engine.destroy();
    expect(constructorCalls[0]).not.toHaveProperty("torrentPort");
    expect(constructorCalls[0]).not.toHaveProperty("dhtPort");
    expect(engine.networkStatus()).toMatchObject({ interface: null, address: null, online: true });
  });
});

describe("TorrentEngine bound to an interface (#164)", () => {
  it("turns off everything that would use another interface", async () => {
    vi.useFakeTimers();
    const { TorrentEngine } = await import("./engine");
    const engine = new TorrentEngine({ interface: "wg0", interfaces: () => table({ wg0: "10.2.0.2" }) });
    engine.add("test-id", MAGNET, "/downloads", {});
    expect(constructorCalls[0]).toMatchObject({ lsd: false, natUpnp: false, natPmp: false, tracker: { wrtc: false } });
    engine.destroy();
  });

  it("registers without attaching while the interface is down, then attaches when it comes up", async () => {
    vi.useFakeTimers();
    const { TorrentEngine } = await import("./engine");
    let current = table({ eth0: "192.168.1.2" });
    const seen: { online: boolean; address: string | null }[] = [];
    const engine = new TorrentEngine({
      interface: "wg0",
      interfaces: () => current,
      guardIntervalMs: 100,
      onNetwork: (s) => seen.push({ online: s.online, address: s.address }),
    });
    const onReady = vi.fn();
    engine.add("test-id", MAGNET, "/downloads", { onReady });
    expect(constructorCalls).toHaveLength(0);
    expect(engine.stats("test-id")).toBeNull();
    expect(engine.networkStatus()).toMatchObject({ interface: "wg0", online: false, address: null, known: ["eth0"] });

    current = table({ eth0: "192.168.1.2", wg0: "10.2.0.2" });
    await vi.advanceTimersByTimeAsync(100);
    // Up, but settling: nothing attached until the interface has held.
    expect(engine.networkStatus()).toMatchObject({ online: true, address: "10.2.0.2" });
    expect(constructorCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(RESUME_SETTLE_MS);
    expect(constructorCalls).toHaveLength(1);
    expect(clients[0]?.added).toEqual([MAGNET]);
    const torrent = (engine as unknown as { torrents: Map<string, EventEmitter> }).torrents.get("test-id");
    torrent?.emit("ready");
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([
      { online: false, address: null },
      { online: true, address: "10.2.0.2" },
    ]);
    engine.destroy();
  });

  it("tears the client down when the interface drops and re-attaches everything on its return, re-resolving the source", async () => {
    vi.useFakeTimers();
    const { TorrentEngine } = await import("./engine");
    let current = table({ wg0: "10.2.0.2" });
    const engine = new TorrentEngine({ interface: "wg0", interfaces: () => current, guardIntervalMs: 100 });
    let meta = false;
    const onReady = vi.fn();
    engine.add("keep", () => (meta ? "/meta/keep.torrent" : MAGNET), "/downloads", { onReady });
    engine.add("drop", MAGNET, "/downloads", {});
    expect(clients[0]?.added).toEqual([MAGNET, MAGNET]);

    current = table({});
    await vi.advanceTimersByTimeAsync(100);
    expect(clients[0]?.destroyed).toBe(true);
    expect(engine.stats("keep")).toBeNull();
    expect(engine.networkStatus()).toMatchObject({ online: false, address: null });
    // Removed while down: must not come back.
    engine.remove("drop");
    // Added while down: must come up with the rest.
    engine.add("late", MAGNET, "/downloads", {});

    meta = true;
    current = table({ wg0: "10.2.0.9" });
    await vi.advanceTimersByTimeAsync(100 + RESUME_SETTLE_MS);
    expect(clients).toHaveLength(2);
    expect(clients[1]?.added).toEqual(["/meta/keep.torrent", MAGNET]);
    expect(engine.networkStatus()).toMatchObject({ online: true, address: "10.2.0.9" });
    const torrent = (engine as unknown as { torrents: Map<string, EventEmitter> }).torrents.get("keep");
    torrent?.emit("ready");
    expect(onReady).toHaveBeenCalledTimes(1);
    engine.destroy();
  });

  it("does not re-attach while the interface is still bouncing", async () => {
    vi.useFakeTimers();
    const { TorrentEngine } = await import("./engine");
    let current = table({ wg0: "10.2.0.2" });
    const engine = new TorrentEngine({ interface: "wg0", interfaces: () => current, guardIntervalMs: 100 });
    engine.add("test-id", MAGNET, "/downloads", {});
    expect(clients).toHaveLength(1);
    for (let i = 0; i < 3; i++) {
      current = table({});
      await vi.advanceTimersByTimeAsync(100);
      current = table({ wg0: "10.2.0.2" });
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(clients).toHaveLength(1);
    expect(engine.stats("test-id")).toBeNull();
    await vi.advanceTimersByTimeAsync(RESUME_SETTLE_MS);
    expect(clients).toHaveLength(2);
    expect(clients[1]?.added).toEqual([MAGNET]);
    engine.destroy();
  });

  it("surfaces a client error, drops a destroyed client, and recovers on reconfigure", async () => {
    vi.useFakeTimers();
    const { TorrentEngine } = await import("./engine");
    const seen: (string | undefined)[] = [];
    const engine = new TorrentEngine({ peerPort: 51413, onNetwork: (s) => seen.push(s.error) });
    engine.add("test-id", MAGNET, "/downloads", {});
    const client = clients[0]!;
    client.destroyed = true;
    client.emit("error", new Error("listen EADDRINUSE: address already in use :::51413"));
    expect(seen.at(-1)).toBe("listen EADDRINUSE: address already in use :::51413");
    expect(engine.networkStatus()).toMatchObject({ error: "listen EADDRINUSE: address already in use :::51413" });
    expect(engine.stats("test-id")).toBeNull();

    expect(engine.reconfigure({ peerPort: 51414 }).ok).toBe(true);
    await flush();
    expect(clients).toHaveLength(2);
    expect(clients[1]?.added).toEqual([MAGNET]);
    expect(engine.networkStatus()).not.toHaveProperty("error");
    engine.destroy();
  });

  it("reports the listen port once the client listens, and counts peers that dialed in", async () => {
    vi.useFakeTimers();
    const { TorrentEngine } = await import("./engine");
    const seen: (number | null)[] = [];
    const engine = new TorrentEngine({
      interface: "wg0",
      peerPort: 51413,
      interfaces: () => table({ wg0: "10.2.0.2" }),
      onNetwork: (s) => seen.push(s.peerPort),
    });
    engine.add("test-id", MAGNET, "/downloads", {});
    const client = clients[0]!;
    client.torrentPort = 51413;
    client.listening = true;
    client.emit("listening");
    expect(seen.at(-1)).toBe(51413);
    const torrent = (engine as unknown as { torrents: Map<string, { wires: { type: string }[] }> }).torrents.get("test-id")!;
    torrent.wires.push({ type: "tcpIncoming" }, { type: "utpOutgoing" }, { type: "utpIncoming" });
    expect(engine.networkStatus()).toMatchObject({ peerPort: 51413, incoming: 2 });
    engine.destroy();
  });
});

describe("TorrentEngine.reconfigure (#164)", () => {
  it("rebuilds the client on new ports without losing a torrent", async () => {
    vi.useFakeTimers();
    const { TorrentEngine } = await import("./engine");
    const engine = new TorrentEngine({ peerPort: 51413 });
    engine.add("test-id", MAGNET, "/downloads", {});
    expect(constructorCalls[0]).toMatchObject({ torrentPort: 51413 });

    const result = engine.reconfigure({ peerPort: 51414, dhtPort: 6881 });
    expect(result.ok).toBe(true);
    await flush();
    expect(clients[0]?.destroyed).toBe(true);
    expect(constructorCalls).toHaveLength(2);
    expect(constructorCalls[1]).toMatchObject({ torrentPort: 51414, dhtPort: 6881 });
    expect(clients[1]?.added).toEqual([MAGNET]);
    engine.destroy();
  });

  it("binds and unbinds in place", async () => {
    vi.useFakeTimers();
    const { TorrentEngine } = await import("./engine");
    const { bindAddress } = await import("../util/bind");
    const engine = new TorrentEngine({ interfaces: () => table({ wg0: "10.2.0.2" }) });
    engine.add("test-id", MAGNET, "/downloads", {});
    expect(bindAddress()).toBeUndefined();

    expect(engine.reconfigure({ interface: "wg0" }).ok).toBe(true);
    await flush();
    expect(bindAddress()).toBe("10.2.0.2");
    expect(constructorCalls[1]).toMatchObject({ lsd: false, tracker: { wrtc: false } });
    expect(clients[1]?.added).toEqual([MAGNET]);

    expect(engine.reconfigure({ interface: null }).ok).toBe(true);
    await flush();
    expect(bindAddress()).toBeUndefined();
    expect(constructorCalls[2]).not.toHaveProperty("lsd");
    expect(engine.networkStatus()).toMatchObject({ interface: null, online: true });
    engine.destroy();
  });

  it("refuses the DHT on the peer port", async () => {
    const { TorrentEngine } = await import("./engine");
    const engine = new TorrentEngine({ peerPort: 51413 });
    expect(engine.reconfigure({ dhtPort: 51413 })).toEqual({ ok: false, error: "dhtPort must differ from peerPort" });
    engine.destroy();
  });
});

describe("TorrentEngine client construction failures (#164)", () => {
  it("still throws from add() on the caller's stack, and forgets the torrent", async () => {
    const { TorrentEngine } = await import("./engine");
    const engine = new TorrentEngine();
    failConstruct = true;
    const onError = vi.fn();
    expect(() => engine.add("test-id", MAGNET, "/downloads", { onError })).toThrow("no native module");
    expect(onError).not.toHaveBeenCalled();
    failConstruct = false;
    expect(engine.reconfigure({ peerPort: 51413 }).ok).toBe(true);
    expect(constructorCalls).toHaveLength(0);
    engine.destroy();
  });

  it("reports it through onError when it happens on a reconnect, off any caller's stack", async () => {
    vi.useFakeTimers();
    const { TorrentEngine } = await import("./engine");
    let current = table({});
    const engine = new TorrentEngine({ interface: "wg0", interfaces: () => current, guardIntervalMs: 100 });
    const onError = vi.fn();
    engine.add("test-id", MAGNET, "/downloads", { onError });
    failConstruct = true;
    current = table({ wg0: "10.2.0.2" });
    await vi.advanceTimersByTimeAsync(100 + RESUME_SETTLE_MS);
    expect(onError).toHaveBeenCalledWith("no native module");
    engine.destroy();
  });
});
