import net from "node:net";
import { Agent, buildConnector, fetch as undiciFetch, type Dispatcher } from "undici";
import { SocksClient } from "socks";
import { setDefaultFetch, type FetchImpl } from "./net";

export interface SocksProxy {
  host: string;
  port: number;
  type: 4 | 5;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 9050;

// Turn whatever the user put in TORLINK_TOR into a proxy URL, or null if they
// switched it off. A truthy switch (1/on/yes/true) maps to Tor's default local
// SOCKS port; `brew services start tor` and the `tor` package both listen on
// 127.0.0.1:9050, while Tor Browser uses 9150, so that's the override people
// reach for. A bare host:port is accepted and assumed to be SOCKS5 with remote
// DNS (socks5h) so .onion resolves through Tor and no lookup leaks locally.
export function resolveTorProxyUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (v === "" || /^(0|off|no|false)$/i.test(v)) return null;
  if (/^(1|on|yes|true)$/i.test(v)) return `socks5h://${DEFAULT_HOST}:${DEFAULT_PORT}`;
  if (/^socks[45]h?:\/\//i.test(v)) return v;
  if (v.includes("://")) return null; // some other scheme — not a SOCKS proxy
  return `socks5h://${v.includes(":") ? v : `${v}:${DEFAULT_PORT}`}`;
}

export function parseSocksProxy(url: string | null): SocksProxy | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const scheme = u.protocol.replace(/:$/, "").toLowerCase();
  const type: 4 | 5 | null =
    scheme === "socks4" || scheme === "socks4a"
      ? 4
      : scheme === "socks5" || scheme === "socks5h" || scheme === "socks"
        ? 5
        : null;
  if (type === null || !u.hostname) return null;
  const port = u.port ? Number(u.port) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host: u.hostname, port, type };
}

// Build an undici dispatcher that tunnels every request through the SOCKS proxy.
export function socksDispatcher(proxy: SocksProxy): Dispatcher {
  const connectTls = buildConnector({});
  return new Agent({
    connect(opts, callback) {
      const port = Number(opts.port) || (opts.protocol === "https:" ? 443 : 80);
      // Hand Tor the hostname, never a pre-resolved IP, so the lookup happens at
      // the exit (socks5h). That's what lets .onion work and keeps the local
      // resolver from ever seeing the target.
      SocksClient.createConnection({
        proxy: { host: proxy.host, port: proxy.port, type: proxy.type },
        command: "connect",
        destination: { host: opts.hostname, port },
      })
        .then(({ socket }) => {
          if (opts.protocol === "https:") {
            // Upgrade the tunnelled TCP socket to TLS with undici's own connector.
            connectTls({ ...opts, httpSocket: socket } as never, callback);
          } else {
            callback(null, socket.setNoDelay());
          }
        })
        .catch((err: unknown) => callback(err as Error, null));
    },
  });
}

export function makeProxiedFetch(proxy: SocksProxy): FetchImpl {
  const dispatcher = socksDispatcher(proxy);
  return (url, init) =>
    undiciFetch(url, { ...(init as object), dispatcher }) as unknown as Promise<Response>;
}

// Best-effort check that something is listening on the SOCKS port. Used only to
// warn the user; it never gates whether the proxy is enforced.
export function probeSocksPort(proxy: SocksProxy, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: proxy.host, port: proxy.port });
    const done = (ok: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

export interface TorStatus {
  enabled: boolean;
  url?: string;
  proxy?: SocksProxy;
  error?: string;
}

// Install the Tor SOCKS proxy for all scouting (source search) requests when the
// user opts in via TORLINK_TOR. Fail *closed*: once enabled, every search fetch
// goes through Tor, so a proxy that is down makes searches error rather than
// quietly dropping back to a direct connection that would leak the user's IP —
// the whole reason they turned this on. A truthy-but-unparseable value is a
// misconfiguration, reported as an error so the caller can refuse to run instead
// of silently going direct.
export function installTorProxy(env: NodeJS.ProcessEnv = process.env): TorStatus {
  const raw = env.TORLINK_TOR?.trim();
  if (!raw || /^(0|off|no|false)$/i.test(raw)) return { enabled: false };
  const url = resolveTorProxyUrl(raw);
  const proxy = parseSocksProxy(url);
  if (!url || !proxy) {
    return {
      enabled: false,
      error: `TORLINK_TOR is set to "${raw}" but that is not a valid SOCKS proxy (try 1, or socks5h://127.0.0.1:9050).`,
    };
  }
  setDefaultFetch(makeProxiedFetch(proxy));
  return { enabled: true, url, proxy };
}
