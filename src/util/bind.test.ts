import dgram from "node:dgram";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  bindAddress,
  clearBindAddress,
  interfaceNames,
  resolveInterface,
  setBindAddress,
  uninstallBindShim,
  type InterfaceTable,
} from "./bind";

function v4(address: string, internal = false): os.NetworkInterfaceInfo {
  return { address, netmask: "255.255.255.0", family: "IPv4", mac: "00:00:00:00:00:00", internal, cidr: `${address}/24` };
}
function v6(address: string, scopeid = 0): os.NetworkInterfaceInfo {
  return { address, netmask: "ffff:ffff:ffff:ffff::", family: "IPv6", mac: "00:00:00:00:00:00", internal: false, cidr: `${address}/64`, scopeid };
}

const TABLE: InterfaceTable = {
  lo: [v4("127.0.0.1", true)],
  eth0: [v4("192.168.1.20"), v6("fe80::1", 2)],
  wg0: [v6("fd00::2"), v4("10.2.0.2")],
  NordLynx: [v4("10.5.0.2")],
  tun1: [v6("fd00::9")],
};

describe("resolveInterface", () => {
  it("takes the first IPv4 address of a named interface, whatever order the OS lists them in", () => {
    expect(resolveInterface("wg0", TABLE)).toEqual({ address: "10.2.0.2", iface: "wg0" });
    expect(resolveInterface("eth0", TABLE)).toEqual({ address: "192.168.1.20", iface: "eth0" });
  });
  it("matches a name without case, the way Windows adapters are named", () => {
    expect(resolveInterface("nordlynx", TABLE)).toEqual({ address: "10.5.0.2", iface: "NordLynx" });
  });
  it("finds an IPv4 literal on whichever interface has it", () => {
    expect(resolveInterface("10.2.0.2", TABLE)).toEqual({ address: "10.2.0.2", iface: "wg0" });
    expect(resolveInterface("127.0.0.1", TABLE)).toEqual({ address: "127.0.0.1", iface: "lo" });
    expect(resolveInterface("10.9.9.9", TABLE)).toBeNull();
  });
  it("is down when the interface is missing, blank, or has no IPv4 address", () => {
    expect(resolveInterface("tun0", TABLE)).toBeNull();
    expect(resolveInterface("  ", TABLE)).toBeNull();
    expect(resolveInterface("tun1", TABLE)).toBeNull();
  });
  it("lists the interface names for a hint", () => {
    expect(interfaceNames(TABLE)).toEqual(["NordLynx", "eth0", "lo", "tun1", "wg0"]);
  });
});

// The shim rewrites Node's own prototypes, so every case runs on real sockets
// over loopback and puts the prototypes back afterwards.
describe("bind shim", () => {
  afterEach(() => uninstallBindShim());

  const listen = (server: net.Server, ...args: unknown[]): Promise<net.AddressInfo> =>
    new Promise((resolve) => {
      (server.listen as (...a: unknown[]) => void)(...args, () => resolve(server.address() as net.AddressInfo));
    });
  const close = (server: net.Server): Promise<void> => new Promise((resolve) => server.close(() => resolve()));
  const bound = (socket: dgram.Socket, ...args: unknown[]): Promise<string> =>
    new Promise((resolve, reject) => {
      socket.once("error", reject);
      (socket.bind as (...a: unknown[]) => void)(...args, () => resolve(socket.address().address));
    });

  it("binds a server that names no host, and leaves one that does alone", async () => {
    setBindAddress("127.0.0.1");
    const a = net.createServer();
    expect((await listen(a, 0)).address).toBe("127.0.0.1");
    await close(a);
    const b = net.createServer();
    expect((await listen(b, { port: 0 })).address).toBe("127.0.0.1");
    await close(b);
    const c = net.createServer();
    expect((await listen(c, 0, "0.0.0.0")).address).toBe("0.0.0.0");
    await close(c);
  });

  it("gives outgoing connections and fetch the bound local address, and fails them closed while down", async () => {
    setBindAddress("127.0.0.1");
    const server = http.createServer((_req, res) => res.end("ok"));
    const { port } = await listen(server, 0);
    const socket = net.connect(port, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    expect(socket.localAddress).toBe("127.0.0.1");
    socket.destroy();
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.ok).toBe(true);

    setBindAddress(null);
    expect(bindAddress()).toBeNull();
    const code = await fetch(`http://127.0.0.1:${port}/`).then(
      () => "ok",
      (e: { cause?: { code?: string } }) => e.cause?.code,
    );
    expect(code).toBe("EADDRNOTAVAIL");
    await close(server);
  });

  it("never overrides a localAddress the caller chose", async () => {
    setBindAddress("127.0.0.2");
    const server = net.createServer();
    const { port } = await listen(server, 0, "127.0.0.1");
    const socket = net.connect({ port, host: "127.0.0.1", localAddress: "127.0.0.1" });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    expect(socket.localAddress).toBe("127.0.0.1");
    socket.destroy();
    await close(server);
  });

  it("binds UDP sockets in every form a dependency uses", async () => {
    setBindAddress("127.0.0.1");
    const a = dgram.createSocket("udp4");
    expect(await bound(a)).toBe("127.0.0.1");
    a.close();
    const b = dgram.createSocket("udp4");
    expect(await bound(b, 0)).toBe("127.0.0.1");
    b.close();
    // k-rpc-socket: bind(port, undefined, cb)
    const c = dgram.createSocket("udp4");
    expect(await bound(c, 0, undefined)).toBe("127.0.0.1");
    c.close();
    // Node's implicit bind inside send()
    const d = dgram.createSocket("udp4");
    await new Promise<void>((resolve, reject) => d.send(Buffer.from("x"), 9, "127.0.0.1", (err) => (err ? reject(err) : resolve())));
    expect(d.address().address).toBe("127.0.0.1");
    d.close();
    const e = dgram.createSocket("udp4");
    expect(await bound(e, 0, "0.0.0.0")).toBe("0.0.0.0");
    e.close();
  });

  it("fails a UDP bind closed while the interface is down", async () => {
    setBindAddress(null);
    const socket = dgram.createSocket("udp4");
    const code = await bound(socket).then(
      () => "bound",
      (e: { code?: string }) => e.code,
    );
    expect(code).toBe("EADDRNOTAVAIL");
    socket.close();
  });

  it("clears back to pass-through and restores the prototypes on uninstall", async () => {
    setBindAddress("127.0.0.1");
    clearBindAddress();
    expect(bindAddress()).toBeUndefined();
    const a = net.createServer();
    expect((await listen(a, 0)).address).not.toBe("127.0.0.1");
    await close(a);

    setBindAddress("127.0.0.1");
    uninstallBindShim();
    const b = net.createServer();
    expect((await listen(b, 0)).address).not.toBe("127.0.0.1");
    await close(b);
  });
});
