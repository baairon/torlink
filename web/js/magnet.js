// Browsers have no raw UDP/DHT access, so udp:// trackers (what a Node client would use)
// are silently useless here — only wss:// (WebSocket) trackers are reachable. Verified live:
// tracker.openwebtorrent.com, tracker.btorrent.xyz, tracker.webtorrent.dev.
const TRACKERS = ["wss://tracker.openwebtorrent.com", "wss://tracker.btorrent.xyz", "wss://tracker.webtorrent.dev"];

export { TRACKERS };

export function buildMagnet(infoHash, name) {
  const dn = encodeURIComponent(name);
  const tr = TRACKERS.map((t) => `&tr=${encodeURIComponent(t)}`).join("");
  return `magnet:?xt=urn:btih:${infoHash}&dn=${dn}${tr}`;
}

const MAGNET_RE = /xt=urn:btih:([a-f0-9]{40}|[a-z2-7]{32})/i;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32ToHex(b32) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const c of b32.toUpperCase()) {
    const idx = BASE32.indexOf(c);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out += ((value >>> bits) & 0xff).toString(16).padStart(2, "0");
      value &= (1 << bits) - 1;
    }
  }
  return out.length === 40 ? out : null;
}

export function normalizeInfoHash(raw) {
  return raw.length === 32 ? (base32ToHex(raw) ?? raw.toLowerCase()) : raw.toLowerCase();
}

export function parseMagnet(input) {
  const s = input.trim();
  if (!/^magnet:\?/i.test(s)) return null;
  const m = MAGNET_RE.exec(s);
  if (!m) return null;
  const infoHash = normalizeInfoHash(m[1]);
  let name = infoHash;
  try {
    const dn = new URL(s).searchParams.get("dn");
    if (dn) name = dn;
  } catch {}
  return { infoHash, name, magnet: s };
}
