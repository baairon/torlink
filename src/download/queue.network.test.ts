import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { uninstallBindShim } from "../util/bind";

vi.mock("webtorrent", () => ({
  default: class extends EventEmitter {
    torrentPort = 0;
    listening = false;
    add(): EventEmitter {
      return new EventEmitter();
    }
    destroy(cb?: () => void): void {
      cb?.();
    }
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  uninstallBindShim();
  vi.resetModules();
});

const h = (id: string) => ({
  id,
  name: id,
  sizeBytes: 1,
  magnet: `magnet:?xt=urn:btih:${id.padEnd(40, "0")}`,
  dir: "/downloads",
  completedAt: 1,
});

describe("DownloadQueue with a bound interface (#164)", () => {
  // The engine reports a down interface from inside the queue's constructor,
  // so the queue has to be whole before the engine exists (it was not, once).
  it("boots with the interface down, keeps items as they are, and reports the state", async () => {
    vi.stubEnv("TORLINK_INTERFACE", "nosuch0");
    const { DownloadQueue } = await import("./queue");
    const q = new DownloadQueue({ playlist: false });
    expect(q.networkStatus()).toMatchObject({ interface: "nosuch0", online: false, address: null });

    q.restoreHistory([h("aaaa")]);
    q.restoreSeeds([{ id: "aaaa", status: "seeding" }]);
    expect(q.getSeeds()[0]).toMatchObject({ id: "aaaa", status: "seeding" });
    q.add({ id: "bbbb", name: "b", magnet: h("bbbb").magnet }, "/downloads");
    expect(q.getItems()[0]).toMatchObject({ id: "bbbb", status: "downloading", peers: 0, speed: 0 });
    q.suspend();
  });

  it("zeroes live numbers and re-emits the engine's report when the interface drops", async () => {
    vi.useFakeTimers();
    try {
      const { DownloadQueue } = await import("./queue");
      const q = new DownloadQueue({ playlist: false });
      q.restoreHistory([h("aaaa")]);
      q.restoreSeeds([{ id: "aaaa", status: "seeding" }]);
      q.add({ id: "bbbb", name: "b", magnet: h("bbbb").magnet }, "/downloads");
      const seed = q.getSeeds()[0]!;
      const item = q.getItems()[0]!;
      seed.uploadSpeed = 5;
      seed.peers = 3;
      item.speed = 9;
      item.peers = 4;
      item.eta = 10;
      const seen: boolean[] = [];
      q.on("network", (s: { online: boolean }) => seen.push(s.online));

      expect(q.reconfigureNetwork({ interface: "nosuch0" }).ok).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(seen).toEqual([false]);
      expect(q.networkStatus().online).toBe(false);
      expect(q.getSeeds()[0]).toMatchObject({ status: "seeding", uploadSpeed: 0, peers: 0 });
      expect(q.getItems()[0]).toMatchObject({ status: "downloading", speed: 0, peers: 0, eta: undefined });
      q.suspend();
    } finally {
      vi.useRealTimers();
    }
  });
});
