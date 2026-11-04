import { afterEach, describe, expect, it, vi } from "vitest";
import type { InterfaceTable } from "../util/bind";
import {
  describeNetwork,
  exportNetworkEnv,
  logNetwork,
  networkFromEnv,
  startInterfaceGuard,
  type NetworkStatus,
} from "./network";

function table(entries: Record<string, string | null>): InterfaceTable {
  const t: InterfaceTable = {};
  for (const [name, address] of Object.entries(entries)) {
    t[name] = address
      ? [{ address, netmask: "255.255.255.0", family: "IPv4", mac: "0", internal: false, cidr: `${address}/24` }]
      : [{ address: "fd00::1", netmask: "ffff::", family: "IPv6", mac: "0", internal: false, cidr: "fd00::1/64", scopeid: 0 }];
  }
  return t;
}

describe("networkFromEnv", () => {
  it("reads the three variables and ignores what it cannot use", () => {
    expect(networkFromEnv({ TORLINK_INTERFACE: " wg0 ", TORLINK_PEER_PORT: "51413", TORLINK_DHT_PORT: "6881" })).toEqual({
      interface: "wg0",
      peerPort: 51413,
      dhtPort: 6881,
    });
    expect(networkFromEnv({ TORLINK_INTERFACE: "", TORLINK_PEER_PORT: "abc", TORLINK_DHT_PORT: "70000" })).toEqual({});
    expect(networkFromEnv({})).toEqual({});
  });
  it("drops a DHT port equal to the peer port: uTP already holds that UDP port", () => {
    expect(networkFromEnv({ TORLINK_PEER_PORT: "51413", TORLINK_DHT_PORT: "51413" })).toEqual({ peerPort: 51413 });
  });
  it("exports flags back into an environment", () => {
    const env: NodeJS.ProcessEnv = {};
    exportNetworkEnv({ interface: "wg0", peerPort: 51413 }, env);
    expect(env).toEqual({ TORLINK_INTERFACE: "wg0", TORLINK_PEER_PORT: "51413" });
  });
});

describe("describeNetwork", () => {
  const base: NetworkStatus = { interface: "wg0", address: null, online: false, peerPort: null, incoming: 0 };
  it("says why an interface is down", () => {
    expect(describeNetwork({ ...base, known: ["eth0", "lo"] })).toBe(
      "network: wg0 down (not found; interfaces: eth0, lo); peers paused",
    );
    expect(describeNetwork({ ...base, known: ["WG0", "lo"] })).toBe("network: wg0 down (no IPv4 address); peers paused");
  });
  it("reports up, then the listen port, and a plain listen port when unbound", () => {
    expect(describeNetwork({ ...base, address: "10.2.0.2", online: true })).toBe("network: wg0 up on 10.2.0.2");
    expect(describeNetwork({ ...base, address: "10.2.0.2", online: true, peerPort: 51413 })).toBe(
      "network: listening on 10.2.0.2:51413",
    );
    expect(describeNetwork({ interface: null, address: null, online: true, peerPort: 51413, incoming: 0 })).toBe(
      "network: listening on *:51413",
    );
  });
});

describe("startInterfaceGuard", () => {
  afterEach(() => vi.useRealTimers());

  it("reports the first state at once, then every change, and a new address as down then up", async () => {
    vi.useFakeTimers();
    let current = table({ eth0: "192.168.1.2", wg0: "10.2.0.2" });
    const seen: (string | null)[] = [];
    const stop = startInterfaceGuard("wg0", (address) => seen.push(address), { intervalMs: 100, table: () => current });
    expect(seen).toEqual(["10.2.0.2"]);

    await vi.advanceTimersByTimeAsync(100);
    expect(seen).toEqual(["10.2.0.2"]);

    current = table({ eth0: "192.168.1.2", wg0: "10.2.0.9" });
    await vi.advanceTimersByTimeAsync(100);
    expect(seen).toEqual(["10.2.0.2", null, "10.2.0.9"]);

    current = table({ eth0: "192.168.1.2" });
    await vi.advanceTimersByTimeAsync(100);
    expect(seen).toEqual(["10.2.0.2", null, "10.2.0.9", null]);

    current = table({ eth0: "192.168.1.2", wg0: null });
    await vi.advanceTimersByTimeAsync(100);
    expect(seen).toEqual(["10.2.0.2", null, "10.2.0.9", null]);

    current = table({ eth0: "192.168.1.2", wg0: "10.2.0.2" });
    await vi.advanceTimersByTimeAsync(100);
    expect(seen).toEqual(["10.2.0.2", null, "10.2.0.9", null, "10.2.0.2"]);

    stop();
    current = table({});
    await vi.advanceTimersByTimeAsync(300);
    expect(seen).toHaveLength(5);
  });

  it("starts down when the interface is not there yet", () => {
    vi.useFakeTimers();
    const seen: (string | null)[] = [];
    const stop = startInterfaceGuard("wg0", (address) => seen.push(address), { intervalMs: 100, table: () => table({}) });
    expect(seen).toEqual([null]);
    stop();
  });
});

describe("logNetwork", () => {
  it("logs the current state once when an interface is configured, then every transition", () => {
    const lines: string[] = [];
    let listener: ((s: NetworkStatus) => void) | undefined;
    const status: NetworkStatus = { interface: "wg0", address: "10.2.0.2", online: true, peerPort: null, incoming: 0 };
    logNetwork(
      { on: (_e, fn) => (listener = fn), networkStatus: () => status },
      (line) => lines.push(line),
    );
    expect(lines).toEqual(["network: wg0 up on 10.2.0.2"]);
    listener?.({ ...status, peerPort: 51413 });
    expect(lines).toEqual(["network: wg0 up on 10.2.0.2", "network: listening on 10.2.0.2:51413"]);
  });
  it("stays quiet at start when nothing is bound", () => {
    const lines: string[] = [];
    logNetwork(
      { on: () => {}, networkStatus: () => ({ interface: null, address: null, online: true, peerPort: null, incoming: 0 }) },
      (line) => lines.push(line),
    );
    expect(lines).toEqual([]);
  });
});
