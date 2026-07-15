import type { DownloadQueue } from "../download/queue";
import { postWebhookEmbed } from "./webhook";
import { finishedEmbed, failedEmbed } from "./embeds";

// Push an embed to the channel whenever a download finishes or fails. Returns a
// detach function so the daemon can unhook cleanly on shutdown.
export function attachNotifications(
  queue: DownloadQueue,
  webhookUrl: string,
  log: (msg: string) => void = () => {},
): () => void {
  const onCompleted = (name: string): void => {
    void postWebhookEmbed(webhookUrl, finishedEmbed(name), { log });
  };
  const onFailed = (name: string, error?: string): void => {
    void postWebhookEmbed(webhookUrl, failedEmbed(name, error), { log });
  };
  queue.on("completed", onCompleted);
  queue.on("failed", onFailed);
  return () => {
    queue.off("completed", onCompleted);
    queue.off("failed", onFailed);
  };
}
