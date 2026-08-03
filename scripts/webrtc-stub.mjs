// Runtime stand-in for webrtc-polyfill, used when the node-datachannel native
// binary is missing or fails to load (npm 12 skips install scripts by default,
// so the binary is often never fetched). dist/cli.cjs redirects the
// webrtc-polyfill specifier here; with RTCPeerConnection undefined,
// simple-peer computes WEBRTC_SUPPORT = false and bittorrent-tracker skips
// WebRTC peers entirely, so the swarm runs on TCP/uTP and DHT peers alone.
// The export list mirrors webrtc-polyfill/index.js so named imports link.

export const RTCPeerConnection = undefined;
export const RTCSessionDescription = undefined;
export const RTCIceCandidate = undefined;
export const RTCIceTransport = undefined;
export const RTCDataChannel = undefined;
export const RTCSctpTransport = undefined;
export const RTCDtlsTransport = undefined;
export const RTCCertificate = undefined;

export default undefined;
