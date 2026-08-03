import { describe, it, expect } from "vitest";
import * as stub from "./webrtc-stub.mjs";

describe("webrtc-stub", () => {
  it("mirrors the webrtc-polyfill export surface with every value undefined", () => {
    expect(Object.keys(stub).sort()).toEqual([
      "RTCCertificate",
      "RTCDataChannel",
      "RTCDtlsTransport",
      "RTCIceCandidate",
      "RTCIceTransport",
      "RTCPeerConnection",
      "RTCSctpTransport",
      "RTCSessionDescription",
      "default",
    ]);
    for (const value of Object.values(stub)) expect(value).toBeUndefined();
  });

  it("makes simple-peer's WEBRTC_SUPPORT check compute false", () => {
    expect(!!stub.RTCPeerConnection).toBe(false);
  });
});
