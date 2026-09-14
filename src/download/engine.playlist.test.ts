import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TorrentEngine } from "./engine";
import { writePlaylists } from "./playlist";

const torrents: EventEmitter[] = [];
vi.mock("webtorrent", () => ({
  default: class extends EventEmitter {
    add(): EventEmitter {
      const torrent = Object.assign(new EventEmitter(), {
        files: [{ path: "Course/1.mp4" }, { path: "Course/2.mp4" }],
        destroy() {},
      });
      torrents.push(torrent);
      return torrent;
    }
    destroy(): void {}
  },
}));
vi.mock("./playlist", () => ({ writePlaylists: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  vi.stubEnv("TORLINK_NO_PLAYLIST", "");
});
afterEach(() => {
  torrents.length = 0;
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("TorrentEngine playlists", () => {
  it("generates by default after completion, without delaying the completion handler", () => {
    const engine = new TorrentEngine();
    const onDone = vi.fn();
    engine.add("course", "magnet:?xt=urn:btih:course", "/downloads", { onDone });
    torrents[0]!.emit("metadata");
    expect(writePlaylists).not.toHaveBeenCalled();
    torrents[0]!.emit("done");
    expect(writePlaylists).toHaveBeenCalledWith("/downloads", ["Course/1.mp4", "Course/2.mp4"]);
    expect(onDone).toHaveBeenCalledOnce();
    engine.destroy();
  });

  it.each(["option", "environment"])("honors the %s opt-out while completing normally", (optOut) => {
    if (optOut === "environment") vi.stubEnv("TORLINK_NO_PLAYLIST", "1");
    const engine = new TorrentEngine(optOut === "option" ? { playlist: false } : {});
    const onDone = vi.fn();
    engine.add("course", "magnet:?xt=urn:btih:course", "/downloads", { onDone });
    torrents[0]!.emit("done");
    expect(writePlaylists).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledOnce();
    engine.destroy();
  });
});
