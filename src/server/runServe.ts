import { createTorzlinkRuntime } from "../core/runtime";
import { VERSION } from "../constants/version";
import {
  notifyDownloadCompleted,
  notifyDownloadFailed,
  notifyDownloadStarted,
} from "../integrations/notify";
import type { AddInput } from "../download/queue";
import type { QueueItem } from "../download/types";
import { startHttpServer } from "./httpServer";
import { serveToken } from "./auth";

export interface ServeOptions {
  host: string;
  port: number;
}

export async function runServe(opts: ServeOptions): Promise<void> {
  const runtime = await createTorzlinkRuntime();

  const onCompleted = (it: QueueItem): void => {
    const durationSec = Math.max(1, (Date.now() - it.addedAt) / 1000);
    notifyDownloadCompleted({
      name: it.name,
      infoHash: it.id,
      dir: it.dir,
      totalBytes: it.totalBytes,
      files: it.files,
      durationSec,
      avgSpeedBytesPerSec: it.totalBytes / durationSec,
    });
  };
  const onFailed = (it: QueueItem): void => {
    notifyDownloadFailed({
      name: it.name,
      infoHash: it.id,
      dir: it.dir,
      error: it.error,
    });
  };
  const onWebAdded = (safe: AddInput): void => {
    notifyDownloadStarted({
      name: safe.name,
      magnet: safe.magnet,
      infoHash: safe.id,
    });
  };

  runtime.queue.on("completed", onCompleted);
  runtime.queue.on("failed", onFailed);
  runtime.queue.on("web-added", onWebAdded);

  const server = await startHttpServer({
    runtime,
    host: opts.host,
    port: opts.port,
  });

  const addr = server.address();
  const where =
    typeof addr === "object" && addr
      ? `${opts.host === "0.0.0.0" ? "0.0.0.0" : addr.address}:${addr.port}`
      : `${opts.host}:${opts.port}`;

  console.log(`TorZlink v${VERSION} serve listening on http://${where}`);
  if (serveToken()) {
    console.log("API auth: TORZLINK_SERVE_TOKEN is set (Bearer required on /api/*).");
  } else {
    console.log(
      "API auth: none (LAN trust). Set TORZLINK_SERVE_TOKEN to require Bearer on /api/*.",
    );
  }
  console.log("UI and API are admin surfaces — keep them behind Traefik / trusted network.");

  const shutdown = (): void => {
    runtime.queue.off("completed", onCompleted);
    runtime.queue.off("failed", onFailed);
    runtime.queue.off("web-added", onWebAdded);
    runtime.dispose();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
