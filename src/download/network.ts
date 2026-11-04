// Network options shared by the CLI, the engine and the daemons: which
// interface peer traffic is bound to, which ports the client listens on, and
// what the engine reports about them.

import os from "node:os";
import {
  interfaceNames,
  resolveInterface,
  setBindAddress,
  type InterfaceTable,
} from "../util/bind";

export interface NetworkOptions {
  // Interface name (wg0, tun0, NordLynx, utun4) or IPv4 literal every peer,
  // tracker, DHT and search socket is bound to. Unset: unbound, as always.
  interface?: string;
  // Fixed TCP + uTP listen port (webtorrent's torrentPort): the one to forward.
  peerPort?: number;
  // Fixed DHT UDP port. Never the peer port: uTP already holds its UDP side.
  dhtPort?: number;
}

export function validPort(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 65535;
}

function portFromEnv(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const n = Number(raw);
  return validPort(n) ? n : undefined;
}

// Bad values are ignored, the way TORLINK_MAX_DOWNLOADS ignores them.
export function networkFromEnv(env: NodeJS.ProcessEnv = process.env): NetworkOptions {
  const iface = env.TORLINK_INTERFACE?.trim();
  const peerPort = portFromEnv(env.TORLINK_PEER_PORT);
  const dhtPort = portFromEnv(env.TORLINK_DHT_PORT);
  return {
    ...(iface ? { interface: iface } : {}),
    ...(peerPort ? { peerPort } : {}),
    ...(dhtPort && dhtPort !== peerPort ? { dhtPort } : {}),
  };
}

// Flags travel to the engine the way TORLINK_NO_UTP does: through the
// environment, which the TUI's own boot, a --daemon child and the search
// command all read, with no plumbing through any of them.
export function exportNetworkEnv(net: NetworkOptions, env: NodeJS.ProcessEnv = process.env): void {
  if (net.interface) env.TORLINK_INTERFACE = net.interface;
  if (net.peerPort) env.TORLINK_PEER_PORT = String(net.peerPort);
  if (net.dhtPort) env.TORLINK_DHT_PORT = String(net.dhtPort);
}

// Bind (or fail closed) from the first moment, before anything can open a
// socket; the engine's guard takes over from here.
export function armInterface(spec: string): void {
  setBindAddress(resolveInterface(spec)?.address ?? null);
}

export interface NetworkStatus {
  interface: string | null;
  // The bound address; null while down, or when nothing is bound.
  address: string | null;
  // False only while a configured interface is down.
  online: boolean;
  // The TCP/uTP port the client accepts peers on, once it listens.
  peerPort: number | null;
  // Live peer connections that dialed in: a forwarded port that works.
  incoming: number;
  // While down: the interfaces that do exist, so a typo shows.
  known?: string[];
  // The client's own last error (a fixed port already taken, uTP that would
  // not start), until the next rebuild.
  error?: string;
}

export function describeNetwork(s: NetworkStatus): string {
  if (s.error !== undefined) return `network: client error: ${s.error}`;
  if (s.interface !== null && !s.online) {
    const known = s.known ?? [];
    const found = known.some((n) => n.toLowerCase() === s.interface!.toLowerCase());
    const why = found ? "no IPv4 address" : `not found; interfaces: ${known.join(", ") || "none"}`;
    return `network: ${s.interface} down (${why}); peers paused`;
  }
  if (s.peerPort !== null) return `network: listening on ${s.address ?? "*"}:${s.peerPort}`;
  if (s.interface !== null) return `network: ${s.interface} up on ${s.address}`;
  return "network: unbound";
}

// Subscribe a daemon's log to the engine's transitions. The first one fires
// inside the queue's constructor, before anyone can listen, so the current
// state is logged once up front when an interface is configured.
export function logNetwork(
  queue: {
    on(event: "network", listener: (status: NetworkStatus) => void): unknown;
    networkStatus(): NetworkStatus;
  },
  log: (line: string) => void,
): void {
  queue.on("network", (s) => log(describeNetwork(s)));
  const now = queue.networkStatus();
  if (now.interface !== null) log(describeNetwork(now));
}

export const GUARD_POLL_MS = 2000;

export interface GuardOptions {
  intervalMs?: number;
  table?: () => InterfaceTable;
}

// Watch an interface and report its IPv4 address whenever it changes: null
// when it is gone (or has no IPv4 address). The first check runs before this
// returns. A new address is reported as down and then up, since every socket
// bound to the old one is dead either way.
export function startInterfaceGuard(
  spec: string,
  onChange: (address: string | null, table: InterfaceTable) => void,
  options: GuardOptions = {},
): () => void {
  const { intervalMs = GUARD_POLL_MS, table = os.networkInterfaces } = options;
  let last: string | null | undefined;
  const check = (): void => {
    const t = table();
    const next = resolveInterface(spec, t)?.address ?? null;
    if (next === last) return;
    if (last != null && next !== null) onChange(null, t);
    last = next;
    onChange(next, t);
  };
  check();
  const timer = setInterval(check, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

export { interfaceNames };
