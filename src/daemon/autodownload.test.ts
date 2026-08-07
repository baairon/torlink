import { describe, it, expect, vi, beforeEach } from "vitest";
import { AutoDownloader } from "./autodownload";
import type { Config } from "../config/config";
import type { DownloadQueue } from "../download/queue";
import * as registry from "../sources/registry";
import type { Source, TorrentResult } from "../sources/types";

describe("AutoDownloader", () => {
  let mockQueue: any;
  let mockConfig: Config;
  let mockSource: any;

  beforeEach(() => {
    mockQueue = {
      hasSeen: vi.fn(),
      add: vi.fn(),
    };

    mockConfig = {
      downloadDir: "/downloads",
      trackers: [],
      throttleEnabled: false,
      throttleDownloadLimit: 0,
      throttleUploadLimit: 0,
      webServerEnabled: false,
      webServerPort: 8080,
      autoDownloads: [],
      autoDownloadIntervalMs: 1000,
    };

    mockSource = {
      id: "fitgirl",
      label: "Test",
      reportsHealth: true,
      homepage: "x",
      search: vi.fn(),
    };

    vi.spyOn(registry, "getSource").mockReturnValue(mockSource as Source);
  });

  it("does nothing if config has no rules", async () => {
    const downloader = new AutoDownloader(mockQueue as unknown as DownloadQueue, mockConfig);
    await downloader.run();
    expect(registry.getSource).not.toHaveBeenCalled();
  });

  it("searches sources and adds matches", async () => {
    mockConfig.autoDownloads = [
      { source: "fitgirl", query: "ubuntu", match: "24\\.04" },
    ];

    const results: TorrentResult[] = [
      { infoHash: "a", name: "ubuntu 22.04", sizeBytes: 0, seeders: 0, leechers: 0, source: "fitgirl", magnet: "a" },
      { infoHash: "b", name: "ubuntu 24.04 desktop", sizeBytes: 0, seeders: 0, leechers: 0, source: "fitgirl", magnet: "b" },
    ];
    mockSource.search.mockResolvedValue(results);
    mockQueue.hasSeen.mockReturnValue(false);

    const downloader = new AutoDownloader(mockQueue as unknown as DownloadQueue, mockConfig);
    await downloader.run();

    expect(mockSource.search).toHaveBeenCalledWith("ubuntu");
    expect(mockQueue.add).toHaveBeenCalledTimes(1);
    expect(mockQueue.add).toHaveBeenCalledWith({ id: "b", name: "ubuntu 24.04 desktop", magnet: "b", source: "fitgirl", sizeBytes: 0 }, "/downloads");
  });

  it("ignores torrents that have been seen", async () => {
    mockConfig.autoDownloads = [
      { source: "fitgirl", query: "ubuntu", match: "24\\.04" },
    ];

    const results: TorrentResult[] = [
      { infoHash: "b", name: "ubuntu 24.04 desktop", sizeBytes: 0, seeders: 0, leechers: 0, source: "fitgirl", magnet: "b" },
    ];
    mockSource.search.mockResolvedValue(results);
    // Pretend we already downloaded it
    mockQueue.hasSeen.mockReturnValue(true);

    const downloader = new AutoDownloader(mockQueue as unknown as DownloadQueue, mockConfig);
    await downloader.run();

    expect(mockQueue.add).not.toHaveBeenCalled();
  });
});
