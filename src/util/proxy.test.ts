import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { getDefaultFetch, setDefaultFetch } from "./net";
import {
  installTorProxy,
  parseSocksProxy,
  probeSocksPort,
  resolveTorProxyUrl,
} from "./proxy";

describe("resolveTorProxyUrl", () => {
  it("returns null when unset or switched off", () => {
    expect(resolveTorProxyUrl(undefined)).toBeNull();
    expect(resolveTorProxyUrl("")).toBeNull();
    for (const off of ["0", "off", "no", "false", "OFF"]) {
      expect(resolveTorProxyUrl(off)).toBeNull();
    }
  });

  it("maps a truthy switch to Tor's default local SOCKS port", () => {
    for (const on of ["1", "on", "yes", "true", "TRUE"]) {
      expect(resolveTorProxyUrl(on)).toBe("socks5h://127.0.0.1:9050");
    }
  });

  it("passes a full socks URL through untouched", () => {
    expect(resolveTorProxyUrl("socks5h://127.0.0.1:9150")).toBe("socks5h://127.0.0.1:9150");
    expect(resolveTorProxyUrl("socks5://box:1080")).toBe("socks5://box:1080");
  });

  it("upgrades a bare host or host:port to socks5h (remote DNS)", () => {
    expect(resolveTorProxyUrl("127.0.0.1:9150")).toBe("socks5h://127.0.0.1:9150");
    expect(resolveTorProxyUrl("torbox")).toBe("socks5h://torbox:9050");
  });

  it("rejects a non-SOCKS scheme", () => {
    expect(resolveTorProxyUrl("http://127.0.0.1:8080")).toBeNull();
  });
});

describe("parseSocksProxy", () => {
  it("parses host, port, and type from each SOCKS scheme", () => {
    expect(parseSocksProxy("socks5h://127.0.0.1:9050")).toEqual({
      host: "127.0.0.1",
      port: 9050,
      type: 5,
    });
    expect(parseSocksProxy("socks4a://box:1080")).toEqual({ host: "box", port: 1080, type: 4 });
  });

  it("defaults the port to 9050 when omitted", () => {
    expect(parseSocksProxy("socks5://127.0.0.1")).toEqual({
      host: "127.0.0.1",
      port: 9050,
      type: 5,
    });
  });

  it("rejects null, junk, non-SOCKS schemes, and bad ports", () => {
    expect(parseSocksProxy(null)).toBeNull();
    expect(parseSocksProxy("not a url")).toBeNull();
    expect(parseSocksProxy("http://127.0.0.1:8080")).toBeNull();
    expect(parseSocksProxy("socks5://127.0.0.1:0")).toBeNull();
    expect(parseSocksProxy("socks5://127.0.0.1:99999")).toBeNull();
  });
});

describe("installTorProxy", () => {
  const original = getDefaultFetch();
  afterEach(() => setDefaultFetch(original));

  it("leaves the default fetch untouched when disabled", () => {
    expect(installTorProxy({})).toEqual({ enabled: false });
    expect(installTorProxy({ TORLINK_TOR: "0" })).toEqual({ enabled: false });
    expect(getDefaultFetch()).toBe(original);
  });

  it("swaps in a proxied fetch when enabled", () => {
    const status = installTorProxy({ TORLINK_TOR: "1" });
    expect(status.enabled).toBe(true);
    expect(status.proxy).toEqual({ host: "127.0.0.1", port: 9050, type: 5 });
    expect(getDefaultFetch()).not.toBe(original);
  });

  it("fails closed on a truthy-but-invalid value: reports an error, stays direct-free", () => {
    const status = installTorProxy({ TORLINK_TOR: "http://nope" });
    expect(status.enabled).toBe(false);
    expect(status.error).toMatch(/not a valid SOCKS proxy/);
    // No proxy installed, but the caller is expected to refuse to run on error,
    // so the default fetch must not have been silently swapped either way.
    expect(getDefaultFetch()).toBe(original);
  });
});

describe("probeSocksPort", () => {
  it("resolves true when something is listening", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;
    try {
      expect(await probeSocksPort({ host: "127.0.0.1", port, type: 5 })).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("resolves false when the port is closed", async () => {
    // Port 1 is privileged and unbound in test environments → connection refused.
    expect(await probeSocksPort({ host: "127.0.0.1", port: 1, type: 5 }, 500)).toBe(false);
  });
});
