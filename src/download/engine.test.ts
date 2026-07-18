import { EventEmitter } from "node:events";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { TorrentFile } from "webtorrent";

// Build a minimal TorrentFile — pickBestFile only reads name and length.
function file(name: string, length: number): TorrentFile {
  return { name, path: name, length };
}

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
});

describe("pickBestFile (stream target selection)", () => {
  it("returns null for an empty file list", async () => {
    const { pickBestFile } = await import("./engine");
    expect(pickBestFile([])).toBeNull();
  });

  it("prefers the largest media file over a larger non-media file", async () => {
    const { pickBestFile } = await import("./engine");
    const picked = pickBestFile([
      file("readme.txt", 500),
      file("movie.mkv", 100),
      file("bigger.iso", 9000), // largest overall, but not playable
      file("feature.mp4", 200), // largest among media files
    ]);
    expect(picked?.name).toBe("feature.mp4");
  });

  it("falls back to the largest file when none are media", async () => {
    const { pickBestFile } = await import("./engine");
    const picked = pickBestFile([
      file("small.bin", 10),
      file("big.bin", 999),
    ]);
    expect(picked?.name).toBe("big.bin");
  });

  it("matches media extensions case-insensitively", async () => {
    const { pickBestFile } = await import("./engine");
    const picked = pickBestFile([file("notes.txt", 800), file("EPISODE.MKV", 100)]);
    expect(picked?.name).toBe("EPISODE.MKV");
  });
});

describe("TorrentEngine.getStreamUrl", () => {
  it("returns null when the torrent has no metadata yet (no file list)", async () => {
    const { TorrentEngine } = await import("./engine");
    const engine = new TorrentEngine();
    // Mocked add() yields a torrent with no `files` — a magnet pre-metadata.
    engine.add(
      "test-id",
      "magnet:?xt=urn:btih:0000000000000000000000000000000000000000",
      "/downloads",
      {},
    );
    await expect(engine.getStreamUrl("test-id")).resolves.toBeNull();
    engine.destroy();
  });

  it("returns null for an unknown torrent id", async () => {
    const { TorrentEngine } = await import("./engine");
    const engine = new TorrentEngine();
    await expect(engine.getStreamUrl("missing")).resolves.toBeNull();
    engine.destroy();
  });
});
