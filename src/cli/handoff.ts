// Single-window handoff (#216): a magnet or .torrent passed to `torlnk` while
// the TUI is already open is added to that window instead of opening a second
// one over the same saved state. The running TUI listens on one local endpoint
// (config/paths.ts); a later launch connects, writes one JSON message and
// leaves. The endpoint is the liveness check as well as the transport, so
// there is no pidfile to go stale: a connect that succeeds means a TUI is up.

import net from "node:net";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { handoffEndpoint } from "../config/paths";

// `torrent` is an absolute path: the sender's working directory is not ours.
export type Handoff = { magnet: string } | { torrent: string };

export interface Inbox {
  // Messages that arrive before anyone subscribes are held and delivered on
  // subscribe, so a handoff during boot is not lost. Returns an unsubscribe.
  subscribe(fn: (msg: Handoff) => void): () => void;
  close(): void;
}

// A magnet with a long tracker list runs to a few kilobytes at most.
const MAX_CHARS = 64 * 1024;
const SEND_TIMEOUT_MS = 2000;

export function parseHandoff(text: string): Handoff | null {
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== "object" || raw === null) return null;
    const { magnet, torrent } = raw as Record<string, unknown>;
    if (typeof magnet === "string" && magnet) return { magnet };
    if (typeof torrent === "string" && torrent) return { torrent };
  } catch {}
  return null;
}

// Connect, deliver `msg` when there is one, and close. True when something was
// listening; with no message this is only a probe for a live owner.
function send(msg: Handoff | undefined, endpoint: string): Promise<boolean> {
  return new Promise((resolve) => {
    let connected = false;
    const sock = net.connect(endpoint);
    sock.once("connect", () => {
      connected = true;
      if (msg) sock.end(JSON.stringify(msg));
      else sock.end();
    });
    sock.on("error", () => {});
    // An owner too busy to read must not hang the launch that is handing off.
    sock.setTimeout(SEND_TIMEOUT_MS, () => sock.destroy());
    sock.once("close", () => resolve(connected));
  });
}

function listen(endpoint: string): Promise<Inbox | null> {
  return new Promise((resolve) => {
    const pending: Handoff[] = [];
    let subscriber: ((msg: Handoff) => void) | null = null;
    const server = net.createServer((sock) => {
      let text = "";
      sock.setEncoding("utf8");
      sock.on("data", (chunk: string) => {
        text += chunk;
        if (text.length > MAX_CHARS) sock.destroy();
      });
      sock.on("end", () => {
        const msg = parseHandoff(text);
        if (!msg) return;
        if (subscriber) subscriber(msg);
        else pending.push(msg);
      });
      sock.on("error", () => {});
    });
    // The TUI exits through process.exit, which skips the close that would
    // remove the socket file, so take it away by hand. Pipes need no cleanup.
    const unlink = (): void => {
      if (process.platform === "win32") return;
      try {
        rmSync(endpoint, { force: true });
      } catch {}
    };
    server.on("error", () => resolve(null));
    server.listen(endpoint, () => {
      // Listening for handoffs is never a reason to keep the process alive.
      server.unref();
      process.on("exit", unlink);
      resolve({
        subscribe(fn) {
          subscriber = fn;
          for (const msg of pending.splice(0)) fn(msg);
          return () => {
            if (subscriber === fn) subscriber = null;
          };
        },
        close() {
          process.off("exit", unlink);
          server.close();
        },
      });
    });
  });
}

// One call per TUI launch. "sent" means a running TUI took `launch` and this
// process should exit. Otherwise this process is the TUI: it gets the inbox
// later launches hand theirs to, or null when it could not listen (a plain
// second `torlnk` beside the first, which keeps the endpoint).
export async function claim(
  launch?: Handoff,
  endpoint: string = handoffEndpoint,
): Promise<"sent" | Inbox | null> {
  if (launch && (await send(launch, endpoint))) return "sent";
  if (process.platform !== "win32") {
    try {
      mkdirSync(path.dirname(endpoint), { recursive: true });
    } catch {}
  }
  const inbox = await listen(endpoint);
  if (inbox) return inbox;
  // The endpoint is taken: by a launch that got there first (several files
  // opened at once), or by a socket file a crashed run left behind.
  if (await send(launch, endpoint)) return launch ? "sent" : null;
  if (process.platform !== "win32") {
    try {
      rmSync(endpoint, { force: true });
    } catch {}
  }
  return listen(endpoint);
}
