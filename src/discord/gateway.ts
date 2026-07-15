// Minimal Discord gateway client, just enough to receive slash-command
// interactions in real time. Uses Node's built-in WebSocket (Node 22+), so it
// adds no dependency, and connects outbound only, so there's no public endpoint
// from behind a NAT or Tailscale. Interactions aren't gated by intents, so we
// identify with intents: 0 (no Message Content intent needed).

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";

export interface GatewayInteraction {
  id: string;
  token: string;
  type: number; // 2 = slash command, 3 = message component (our select menu)
  data?: {
    name?: string;
    options?: { name: string; value: unknown }[];
    custom_id?: string;
    values?: string[];
  };
  member?: { user?: { id?: string; username?: string } };
  user?: { id?: string; username?: string };
  channel_id?: string;
}

export function startGateway(opts: {
  token: string;
  onInteraction: (i: GatewayInteraction) => void;
  onReady?: (botId: string) => void;
  log?: (m: string) => void;
}): { stop: () => void } {
  const log = opts.log ?? (() => {});
  let ws: WebSocket | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let reconnect: ReturnType<typeof setTimeout> | null = null;
  let seq: number | null = null;
  let acked = true;
  let stopped = false;

  const stopHeartbeat = (): void => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  };

  const beat = (): void => {
    if (!ws || ws.readyState !== ws.OPEN) return;
    if (!acked) {
      // The last heartbeat went unanswered, so the socket is a zombie. Drop it
      // and let the close handler reconnect.
      log("gateway: heartbeat unacknowledged, reconnecting");
      ws.close(4000);
      return;
    }
    acked = false;
    ws.send(JSON.stringify({ op: 1, d: seq }));
  };

  const connect = (): void => {
    if (stopped) return;
    ws = new WebSocket(GATEWAY_URL);

    ws.addEventListener("message", (ev) => {
      let payload: { op: number; d: unknown; s: number | null; t: string | null };
      try {
        payload = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const { op, d, s, t } = payload;
      if (typeof s === "number") seq = s;

      if (op === 10) {
        // HELLO: start heartbeating, then identify.
        const interval = (d as { heartbeat_interval: number }).heartbeat_interval;
        stopHeartbeat();
        acked = true;
        heartbeat = setInterval(beat, interval);
        ws!.send(
          JSON.stringify({
            op: 2,
            d: {
              token: opts.token,
              intents: 0,
              properties: { os: "linux", browser: "torlink", device: "torlink" },
            },
          }),
        );
      } else if (op === 1) {
        beat(); // server asked for a heartbeat now
      } else if (op === 11) {
        acked = true; // heartbeat ACK
      } else if (op === 7 || op === 9) {
        ws!.close(4000); // reconnect / invalid session -> fresh connect
      } else if (op === 0) {
        if (t === "READY") {
          const botId = (d as { user?: { id?: string } }).user?.id ?? "";
          log("gateway: ready");
          opts.onReady?.(botId);
        } else if (t === "INTERACTION_CREATE") {
          opts.onInteraction(d as GatewayInteraction);
        }
      }
    });

    ws.addEventListener("close", (ev) => {
      stopHeartbeat();
      if (stopped) return;
      log(`gateway: closed (${ev.code}); reconnecting in 3s`);
      reconnect = setTimeout(connect, 3000);
    });

    // 'error' is always followed by 'close', which handles the reconnect.
    ws.addEventListener("error", () => {});
  };

  connect();

  return {
    stop: () => {
      stopped = true;
      stopHeartbeat();
      if (reconnect) clearTimeout(reconnect);
      ws?.close(1000);
    },
  };
}
