// Bind every socket this process opens to one interface's address.
//
// webtorrent 3 has no option for this: its TCP server, outgoing dials, uTP,
// UDP trackers and DHT all bind the wildcard, and so does the fetch behind
// search. The one place all of them pass through is Node's own net and dgram
// prototypes (plus utp-native, which opens its UDP socket in native code), so
// that is where the address goes in. Only a call that names no address is
// touched, and nothing here runs unless an interface is configured.
//
// Fail closed: while the interface is configured but gone, new sockets get an
// address no host has (RFC 5737 TEST-NET-1) and die with EADDRNOTAVAIL instead
// of leaving through whatever the default route is now.

import dgram from "node:dgram";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";

export const UNROUTABLE = "192.0.2.1";

export type InterfaceTable = NodeJS.Dict<os.NetworkInterfaceInfo[]>;

export interface BoundAddress {
  address: string;
  iface: string;
}

export function interfaceNames(table: InterfaceTable = os.networkInterfaces()): string[] {
  return Object.keys(table).sort();
}

function isIPv4Entry(entry: os.NetworkInterfaceInfo): boolean {
  // Node 18.0-18.3 reported the family as a number; every version torlink
  // supports reports "IPv4", but a stray 4 costs nothing to accept.
  return entry.family === "IPv4" || (entry.family as unknown) === 4;
}

// `spec` is an interface name (wg0, tun0, NordLynx, utun4) or an IPv4 literal.
// A name matches exactly first, then without case (Windows adapters carry
// friendly names). An interface with no IPv4 address counts as down.
export function resolveInterface(
  spec: string,
  table: InterfaceTable = os.networkInterfaces(),
): BoundAddress | null {
  const want = spec.trim();
  if (!want) return null;
  if (net.isIPv4(want)) {
    for (const [iface, entries] of Object.entries(table)) {
      if (entries?.some((e) => isIPv4Entry(e) && e.address === want)) return { address: want, iface };
    }
    return null;
  }
  const names = Object.keys(table);
  const iface =
    names.find((n) => n === want) ?? names.find((n) => n.toLowerCase() === want.toLowerCase());
  if (iface === undefined) return null;
  const entry = table[iface]?.find(isIPv4Entry);
  return entry ? { address: entry.address, iface } : null;
}

// undefined: no interface configured, every socket behaves as it always has.
// null: configured but down, so sockets fail closed. A string: bound to it.
let current: string | null | undefined;

function effective(): string | undefined {
  if (current === undefined) return undefined;
  return current ?? UNROUTABLE;
}

export function bindAddress(): string | null | undefined {
  return current;
}

export function setBindAddress(address: string | null): void {
  install();
  current = address;
}

export function clearBindAddress(): void {
  current = undefined;
}

type AnyFn = (this: unknown, ...args: unknown[]) => unknown;

interface Originals {
  connect: AnyFn;
  listen: AnyFn;
  bind: AnyFn;
  utp?: { proto: { bind: AnyFn }; bind: AnyFn };
}

let originals: Originals | null = null;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Socket#connect: a pre-normalized [options, cb] pair (what net.connect hands
// over), a plain options object, or (port[, host][, cb]). Paths are pipes.
// undici passes localAddress: null, so "none given" is a loose null check.
function withLocalAddress(args: unknown[], address: string): unknown[] {
  const bound = (opts: Record<string, unknown>): Record<string, unknown> =>
    opts.port !== undefined && opts.path === undefined && opts.localAddress == null
      ? { ...opts, localAddress: address, family: opts.family || 4 }
      : opts;
  const first = args[0];
  if (Array.isArray(first)) {
    if (isRecord(first[0])) first[0] = bound(first[0]);
    return args;
  }
  if (isRecord(first)) return [bound(first), ...args.slice(1)];
  if (typeof first === "number") {
    const host = typeof args[1] === "string" ? args[1] : undefined;
    const cb = typeof args[1] === "function" ? args[1] : args[2];
    const opts = bound(host === undefined ? { port: first } : { port: first, host });
    return cb === undefined ? [opts] : [opts, cb];
  }
  return args;
}

// Server#listen: (port[, backlog][, cb]), ([cb]) and { port } without a host
// get one; a path, a handle or an explicit host are left alone.
function withListenHost(args: unknown[], address: string): unknown[] {
  const first = args[0];
  if (first === undefined || typeof first === "function") return [0, address, ...args];
  if (typeof first === "number" || (typeof first === "string" && /^\d+$/.test(first))) {
    if (typeof args[1] === "string") return args;
    return [first, address, ...args.slice(1)];
  }
  if (isRecord(first) && first.port !== undefined && first.path === undefined && first.fd === undefined) {
    if (first.host == null) return [{ ...first, host: address }, ...args.slice(1)];
  }
  return args;
}

// dgram Socket#bind: (), (cb), (port[, cb]), (port, undefined, cb) as
// k-rpc-socket calls it, and the { port, exclusive } object Node itself uses
// for the implicit bind inside send(). An explicit address stays.
function withBindAddress(args: unknown[], address: string): unknown[] {
  const first = args[0];
  if (first === undefined || typeof first === "function") return [0, address, ...args.filter((a) => a !== undefined)];
  if (typeof first === "number") {
    if (typeof args[1] === "string") return args;
    const rest = args.slice(1);
    if (rest[0] == null) rest.shift();
    return [first, address, ...rest];
  }
  if (isRecord(first) && first.fd === undefined && first.address == null) {
    return [{ ...first, address }, ...args.slice(1)];
  }
  return args;
}

// utp-native opens its UDP socket in native code, so the dgram wrapper never
// sees it; its own bind(port, ip, cb) defaults ip to 0.0.0.0. Load the very
// instance webtorrent requires (resolving through webtorrent, so a nested or
// pnpm layout still lands on the same module) and wrap that.
function patchUtp(): Originals["utp"] | undefined {
  try {
    const here = createRequire(import.meta.url);
    const fromWebtorrent = createRequire(here.resolve("webtorrent"));
    const UTP = fromWebtorrent("utp-native") as { prototype: { bind: AnyFn } };
    const proto = UTP.prototype;
    const bind = proto.bind;
    if (typeof bind !== "function") return undefined;
    proto.bind = function (this: unknown, port?: unknown, ip?: unknown, cb?: unknown): unknown {
      const address = effective();
      if (address === undefined) return bind.call(this, port, ip, cb);
      if (typeof port === "function") return bind.call(this, 0, address, port);
      if (typeof ip === "function") return bind.call(this, port, address, ip);
      return bind.call(this, port, ip || address, cb);
    };
    return { proto, bind };
  } catch {
    return undefined;
  }
}

function install(): void {
  if (originals) return;
  const connect = net.Socket.prototype.connect as unknown as AnyFn;
  const listen = net.Server.prototype.listen as unknown as AnyFn;
  const bind = dgram.Socket.prototype.bind as unknown as AnyFn;
  originals = { connect, listen, bind, utp: patchUtp() };

  (net.Socket.prototype as unknown as { connect: AnyFn }).connect = function (this: unknown, ...args: unknown[]) {
    const address = effective();
    return connect.apply(this, address === undefined ? args : withLocalAddress(args, address));
  };
  (net.Server.prototype as unknown as { listen: AnyFn }).listen = function (this: unknown, ...args: unknown[]) {
    const address = effective();
    return listen.apply(this, address === undefined ? args : withListenHost(args, address));
  };
  (dgram.Socket.prototype as unknown as { bind: AnyFn }).bind = function (this: unknown, ...args: unknown[]) {
    const address = effective();
    return bind.apply(this, address === undefined ? args : withBindAddress(args, address));
  };
}

// Whether the uTP socket can be bound too. When it cannot, a bound client runs
// without uTP rather than with a uTP socket open on every interface.
export function utpBindable(): boolean {
  install();
  return originals?.utp !== undefined;
}

// Tests only: put the prototypes back and forget the address.
export function uninstallBindShim(): void {
  if (originals) {
    (net.Socket.prototype as unknown as { connect: AnyFn }).connect = originals.connect;
    (net.Server.prototype as unknown as { listen: AnyFn }).listen = originals.listen;
    (dgram.Socket.prototype as unknown as { bind: AnyFn }).bind = originals.bind;
    if (originals.utp) originals.utp.proto.bind = originals.utp.bind;
  }
  originals = null;
  current = undefined;
}
