import { getSource } from "../sources/registry";
import type { DownloadQueue } from "../download/queue";
import type { Config } from "../config/config";
import type { TorrentResult } from "../sources/types";

export class AutoDownloader {
  private queue: DownloadQueue;
  private config: Config;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private log: (msg: string) => void;

  constructor(queue: DownloadQueue, config: Config, log: (msg: string) => void = () => {}) {
    this.queue = queue;
    this.config = config;
    this.log = log;
  }

  start() {
    if (this.timer) return;
    const interval = this.config.autoDownloadIntervalMs > 0 ? this.config.autoDownloadIntervalMs : 3600000;
    this.timer = setInterval(() => void this.run(), interval);
    
    // Initial run after a short delay so boot isn't blocked
    const initialDelayTimer = setTimeout(() => void this.run(), 5000);
    initialDelayTimer.unref(); // prevent this from blocking process exit
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  setConfig(config: Config) {
    this.config = config;
    // Restart timer if interval changed
    if (this.timer) {
      this.stop();
      this.start();
    }
  }

  async run() {
    if (this.running || !this.config.autoDownloads || this.config.autoDownloads.length === 0) {
      return;
    }
    
    this.running = true;
    try {
      for (const rule of this.config.autoDownloads) {
        const src = getSource(rule.source);
        if (!src) {
          this.log(`AutoDownloader: Unknown source ${rule.source}`);
          continue;
        }

        let results: TorrentResult[] = [];
        try {
          results = await src.search(rule.query);
        } catch (e) {
          this.log(`AutoDownloader: Search failed for ${rule.source}: ${e}`);
          continue;
        }

        let rx: RegExp;
        try {
          rx = new RegExp(rule.match, "i");
        } catch (e) {
          this.log(`AutoDownloader: Invalid regex "${rule.match}" for ${rule.source}`);
          continue;
        }

        for (const r of results) {
          if (rx.test(r.name)) {
            if (!this.queue.hasSeen(r.infoHash)) {
              this.log(`AutoDownloader: Adding ${r.name}`);
              this.queue.add({ id: r.infoHash, name: r.name, magnet: r.magnet, source: r.source, sizeBytes: r.sizeBytes }, this.config.downloadDir);
            }
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}
