import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadQueue } from "./queue";
import { writePlaylists } from "./playlist";
import type { AddHandlers } from "./engine";

// The engine is stubbed to hand back the handlers the queue gives it, so each
// test fires `done` itself. The same event means a download finishing or a
// restored seed passing verification, and only the first may write playlists.
const handlers = new Map<string, AddHandlers>();

vi.mock("./engine", () => ({
  TorrentEngine: class {
    add(id: string, _source: string, _dir: string, h: AddHandlers): void {
      handlers.set(id, h);
    }
    filePaths(): string[] {
      return ["Course/1.mp4", "Course/2.mp4"];
    }
    remove(): void {}
    stats(): undefined {
      return undefined;
    }
    destroy(): void {}
  },
}));
vi.mock("./playlist", () => ({ writePlaylists: vi.fn().mockResolvedValue(undefined) }));

const MAGNET = "magnet:?xt=urn:btih:0000000000000000000000000000000000000000";

beforeEach(() => {
  vi.stubEnv("TORLINK_NO_PLAYLIST", "");
});
afterEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("DownloadQueue playlists", () => {
  it("writes playlists into the download dir when a download finishes", () => {
    const q = new DownloadQueue();
    q.add({ id: "t1", name: "Course", magnet: MAGNET }, "/downloads");
    handlers.get("t1")!.onDone!();
    expect(writePlaylists).toHaveBeenCalledWith("/downloads", ["Course/1.mp4", "Course/2.mp4"]);
    q.suspend();
  });

  // Restored seeds verify on every launch, so writing here would put back a
  // playlist the user deleted.
  it("leaves a restored seed alone when it passes verification", () => {
    const q = new DownloadQueue();
    q.restoreHistory([
      { id: "s1", name: "Course", magnet: MAGNET, dir: "/downloads", sizeBytes: 100, completedAt: 1 },
    ]);
    q.restoreSeeds([{ id: "s1", status: "seeding" }]);
    handlers.get("s1")!.onDone!();
    expect(writePlaylists).not.toHaveBeenCalled();
    q.suspend();
  });

  it.each(["option", "environment"])("honors the %s opt-out while completing normally", (optOut) => {
    if (optOut === "environment") vi.stubEnv("TORLINK_NO_PLAYLIST", "1");
    const q = new DownloadQueue(optOut === "option" ? { playlist: false } : {});
    q.add({ id: "t2", name: "Course", magnet: MAGNET }, "/downloads");
    handlers.get("t2")!.onDone!();
    expect(writePlaylists).not.toHaveBeenCalled();
    expect(q.getSeed("t2")?.status).toBe("seeding");
    q.suspend();
  });
});
