import { EventEmitter } from "node:events";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { TorrentMeta } from "./engine";

const addOpts: Record<string, unknown>[] = [];

vi.mock("webtorrent", () => {
  return {
    default: class extends EventEmitter {
      torrentPort = 6881;
      add(_source: string, opts?: Record<string, unknown>): EventEmitter {
        addOpts.push(opts ?? {});
        return new EventEmitter();
      }
      destroy(): void {}
    },
  };
});

afterEach(() => {
  addOpts.length = 0;
  vi.resetModules();
});

// A fake TorrentFile that records whether it was selected or deselected.
function fakeFile(length: number) {
  return {
    length,
    selected: false,
    deselected: false,
    select() {
      this.selected = true;
    },
    deselect() {
      this.deselected = true;
    },
  };
}

async function makeEngine() {
  const { TorrentEngine } = await import("./engine");
  return new TorrentEngine();
}

// Reach into the private torrents map to drive the mock torrent's metadata.
function grabTorrent(engine: unknown, id: string): EventEmitter & Record<string, unknown> {
  const map = (engine as { torrents: Map<string, unknown> }).torrents;
  return map.get(id) as EventEmitter & Record<string, unknown>;
}

const MAGNET = "magnet:?xt=urn:btih:0000000000000000000000000000000000000000";

describe("TorrentEngine file exclusion", () => {
  it("adds with deselect:true and selects only the kept files", async () => {
    const engine = await makeEngine();
    let meta: TorrentMeta | undefined;
    engine.add("id1", MAGNET, "/dl", { onMetadata: (m) => (meta = m) }, undefined, [1]);

    // deselect option must be set so nothing downloads until we select.
    expect(addOpts[0]).toMatchObject({ deselect: true });

    const t = grabTorrent(engine, "id1");
    const files = [fakeFile(100), fakeFile(200), fakeFile(300)] as const;
    t.files = files;
    t.length = 600;
    t.name = "pack";
    t.emit("metadata");

    expect(files[0].selected).toBe(true);
    expect(files[0].deselected).toBe(false);
    expect(files[1].deselected).toBe(true); // excluded index 1
    expect(files[1].selected).toBe(false);
    expect(files[2].selected).toBe(true);
    // Reported total is the selected bytes, not the whole torrent.
    expect(meta?.total).toBe(400);
    engine.destroy();
  });

  it("never sets deselect when nothing is excluded", async () => {
    const engine = await makeEngine();
    engine.add("id2", MAGNET, "/dl", {}, undefined, []);
    expect(addOpts[0]).not.toHaveProperty("deselect");
    engine.destroy();
  });

  it("reselect() flips selection on a running torrent and returns selected bytes", async () => {
    const engine = await makeEngine();
    engine.add("id4", MAGNET, "/dl", {}, undefined, []); // added with everything selected

    const t = grabTorrent(engine, "id4");
    const files = [fakeFile(100), fakeFile(200), fakeFile(300)] as const;
    t.files = files;
    t.length = 600;

    // Now exclude file 0: it deselects all, then re-selects the kept ones.
    const selected = engine.reselect("id4", [0]);
    expect(selected).toBe(500);
    expect(files[0].selected).toBe(false);
    expect(files[1].selected).toBe(true);
    expect(files[2].selected).toBe(true);
    // Kept files must never be deselected — emptying selections would drop peer
    // interest and stall the download, which reads as a restart.
    expect(files[0].deselected).toBe(true);
    expect(files[1].deselected).toBe(false);
    expect(files[2].deselected).toBe(false);
    // stats now rescale against the 500 kept bytes.
    t.downloaded = 250;
    t.progress = 250 / 600;
    expect(engine.stats("id4")?.total).toBe(500);
    expect(engine.stats("id4")?.progress).toBeCloseTo(0.5, 5);
    engine.destroy();
  });

  it("reselect() with no exclusions clears the rescale and reports full length", async () => {
    const engine = await makeEngine();
    engine.add("id5", MAGNET, "/dl", {}, undefined, [1]);
    const t = grabTorrent(engine, "id5");
    t.files = [fakeFile(100), fakeFile(200)] as const;
    t.length = 300;
    t.emit("metadata");
    expect(engine.stats("id5")?.total).toBe(100); // only file 0 selected

    const full = engine.reselect("id5", []);
    expect(full).toBe(300);
    // No exclusions → stats fall back to webtorrent's whole-torrent length.
    t.downloaded = 150;
    t.progress = 0.5;
    expect(engine.stats("id5")?.total).toBe(300);
    engine.destroy();
  });

  it("reselect() returns null when the torrent isn't present", async () => {
    const engine = await makeEngine();
    expect(engine.reselect("nope", [0])).toBeNull();
    engine.destroy();
  });

  it("rescales stats progress/total against the selected bytes", async () => {
    const engine = await makeEngine();
    engine.add("id3", MAGNET, "/dl", {}, undefined, [0]);

    const t = grabTorrent(engine, "id3");
    const files = [fakeFile(100), fakeFile(300)];
    t.files = files;
    t.length = 400; // whole torrent
    t.name = "pack";
    // 150 of the 300 selected bytes downloaded (50% of what we're fetching).
    t.downloaded = 150;
    t.progress = 150 / 400; // webtorrent's whole-torrent ratio (37.5%)
    t.downloadSpeed = 150;
    t.emit("metadata");

    const s = engine.stats("id3");
    expect(s?.total).toBe(300);
    expect(s?.progress).toBeCloseTo(0.5, 5);
    engine.destroy();
  });
});
