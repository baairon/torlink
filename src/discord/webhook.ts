import { fetchResilient, USER_AGENT, type FetchImpl } from "../util/net";
import type { Embed } from "./embeds";

// Discord rejects messages over 2000 characters; leave a margin and mark the cut.
const MAX_CONTENT = 1900;
const WEBHOOK_NAME = "torlink";

export function trimForDiscord(content: string): string {
  return content.length <= MAX_CONTENT ? content : `${content.slice(0, MAX_CONTENT - 1)}…`;
}

interface WebhookBody {
  content?: string;
  embeds?: Embed[];
}

// Post to a channel through its webhook. Outbound only and best-effort: a message
// that can't be delivered must never take the daemon down, so this reports false
// rather than throwing.
async function send(
  url: string,
  body: WebhookBody,
  opts: { log?: (msg: string) => void; fetchImpl?: FetchImpl },
): Promise<boolean> {
  const log = opts.log ?? (() => {});
  try {
    const res = await fetchResilient(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify({ username: WEBHOOK_NAME, ...body }),
      retries: 2,
      fetchImpl: opts.fetchImpl,
    });
    if (!res.ok) {
      log(`discord webhook -> HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    log(`discord webhook failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

export function postWebhook(
  url: string,
  content: string,
  opts: { log?: (msg: string) => void; fetchImpl?: FetchImpl } = {},
): Promise<boolean> {
  return send(url, { content: trimForDiscord(content) }, opts);
}

export function postWebhookEmbed(
  url: string,
  embed: Embed,
  opts: { log?: (msg: string) => void; fetchImpl?: FetchImpl } = {},
): Promise<boolean> {
  return send(url, { embeds: [embed] }, opts);
}
