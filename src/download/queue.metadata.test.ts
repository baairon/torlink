import { describe, it, expect, vi, beforeEach } from "vitest";
import { DownloadQueue } from "./queue";
import * as persist from "./persist";
import { promises as fs } from "node:fs";
import parseTorrent from "parse-torrent";

vi.mock("./engine", () => {
  const mockEngine = {
    getMetadata: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
  };
  return {
    TorrentEngine: vi.fn().mockImplementation(function() { return mockEngine; }),
    message: vi.fn((e) => String(e)),
  };
});

vi.mock("./persist", () => ({
  torrentMetaExists: vi.fn(),
  torrentMetaPath: vi.fn(),
}));

vi.mock("node:fs", () => ({
  promises: {
    readFile: vi.fn(),
  },
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
}));

vi.mock("parse-torrent", () => ({
  default: vi.fn(),
}));

describe("DownloadQueue getMetadata", () => {
  let queue: DownloadQueue;
  let engineMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    queue = new DownloadQueue();
    engineMock = (queue as any).engine;
  });

  it("returns live metadata from engine if available", async () => {
    const fakeMeta = { infoHash: "abc", name: "test", announce: [] };
    engineMock.getMetadata.mockReturnValue(fakeMeta);

    const result = await queue.getMetadata("abc");
    expect(engineMock.getMetadata).toHaveBeenCalledWith("abc");
    expect(result).toBe(fakeMeta);
  });

  it("parses .torrent file from disk if engine has no live meta", async () => {
    engineMock.getMetadata.mockReturnValue(null);
    vi.mocked(persist.torrentMetaExists).mockReturnValue(true);
    vi.mocked(persist.torrentMetaPath).mockReturnValue("/tmp/test.torrent");
    
    const fakeBuf = Buffer.from("test");
    vi.mocked(fs.readFile).mockResolvedValue(fakeBuf);
    
    vi.mocked(parseTorrent).mockReturnValue({
      infoHash: "abc",
      name: "parsed name",
      announce: ["http://tracker.org"],
      length: 123,
    } as any);

    const result = await queue.getMetadata("abc");
    expect(result).toMatchObject({
      infoHash: "abc",
      name: "parsed name",
      announce: ["http://tracker.org"],
      length: 123,
    });
    expect(fs.readFile).toHaveBeenCalledWith("/tmp/test.torrent");
  });

  it("parses magnet URI if not in engine and no .torrent file", async () => {
    engineMock.getMetadata.mockReturnValue(null);
    vi.mocked(persist.torrentMetaExists).mockReturnValue(false);

    vi.mocked(parseTorrent).mockReturnValue({
      infoHash: "def",
      name: "magnet name",
      announce: ["udp://tracker2.org"],
    } as any);

    const magnet = "magnet:?xt=urn:btih:def&dn=magnet+name";
    const result = await queue.getMetadata("def", magnet);

    expect(parseTorrent).toHaveBeenCalledWith(magnet);
    expect(result).toMatchObject({
      infoHash: "def",
      name: "magnet name",
      announce: ["udp://tracker2.org"],
    });
  });

  it("returns null if no sources have metadata", async () => {
    engineMock.getMetadata.mockReturnValue(null);
    vi.mocked(persist.torrentMetaExists).mockReturnValue(false);

    const result = await queue.getMetadata("xyz");
    expect(result).toBeNull();
  });
});
