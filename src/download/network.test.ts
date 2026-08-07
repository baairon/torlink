import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockNetConnect, mockDgramBind, mockDgramCreateSocket } = vi.hoisted(() => {
  const mockDgramBind = vi.fn();
  return {
    mockNetConnect: vi.fn(),
    mockDgramBind,
    mockDgramCreateSocket: vi.fn(() => ({ bind: mockDgramBind })),
  };
});

vi.mock("node:net", () => ({
  default: { connect: mockNetConnect },
  connect: mockNetConnect,
}));

vi.mock("node:dgram", () => ({
  default: { createSocket: mockDgramCreateSocket },
  createSocket: mockDgramCreateSocket,
}));

import net from "node:net";
import dgram from "node:dgram";
import { applyNetworkBinding } from "./network";
import type { Config } from "../config/config";
import { defaultConfig } from "../config/config";

describe("Network Binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("injects localAddress into net.connect when configured", () => {
    const cfg: Config = { ...defaultConfig, bindAddress: "10.8.0.2" };
    applyNetworkBinding(cfg);

    net.connect(80, "example.com");

    expect(mockNetConnect).toHaveBeenCalledWith(
      expect.objectContaining({ port: 80, host: "example.com", localAddress: "10.8.0.2" })
    );
  });

  it("injects address into dgram socket bind when configured", () => {
    const cfg: Config = { ...defaultConfig, bindAddress: "10.8.0.2" };
    applyNetworkBinding(cfg);

    const socket = dgram.createSocket("udp4");
    expect(mockDgramCreateSocket).toHaveBeenCalled();

    socket.bind(1234);
    expect(mockDgramBind).toHaveBeenCalledWith(1234, "10.8.0.2");
  });
});
