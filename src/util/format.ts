export function formatBytes(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

const SIZE_UNITS: Record<string, number> = {
  B: 1,
  KIB: 1024,
  MIB: 1024 ** 2,
  GIB: 1024 ** 3,
  TIB: 1024 ** 4,
  KB: 1000,
  MB: 1e6,
  GB: 1e9,
  TB: 1e12,
};

export function parseSize(s: string): number {
  const m = s.match(/([\d.]+)\s*([KMGT]?I?B)/i);
  if (!m) return 0;
  return Math.round(parseFloat(m[1]!) * (SIZE_UNITS[m[2]!.toUpperCase()] ?? 1));
}

export function formatBytesPerSec(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 10_000) return String(Math.round(n));
  const k = Math.round(n / 1_000);
  if (k < 1_000) return `${k}k`;
  const m = n / 1_000_000;
  return m < 10 ? `${m.toFixed(1).replace(/\.0$/, "")}m` : `${Math.round(m)}m`;
}

export function formatRelative(unixSeconds?: number): string {
  if (!unixSeconds || !Number.isFinite(unixSeconds) || unixSeconds <= 0) return "";
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 60) return "now";
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) {
    const rm = m % 60;
    return rm > 0 ? `${h}hr ${rm}m ago` : `${h}hr ago`;
  }
  const d = Math.floor(h / 24);
  if (d < 30) {
    const rh = h % 24;
    return rh > 0 ? `${d}d ${rh}hr ago` : `${d}d ago`;
  }
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function formatEtaShort(sec?: number): string {
  if (sec === undefined || !Number.isFinite(sec) || sec < 0) return "";
  const total = Math.round(sec);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0)
    return [`${d}d`, h > 0 ? `${h}hr` : "", m > 0 ? `${m}m` : ""]
      .filter(Boolean)
      .join(" ");
  if (h > 0) return m > 0 ? `${h}hr ${m}m` : `${h}hr`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

function isJunkCodePoint(cp: number): boolean {
  if (cp < 0x20 || cp === 0x7f) return true;
  if (cp === 0xfffd) return true;
  if (cp >= 0x200b && cp <= 0x200f) return true;
  if (cp >= 0x2028 && cp <= 0x202e) return true;
  if (cp === 0x2060 || cp === 0xfeff) return true;
  if (cp === 0x200d || cp === 0xfe0f || cp === 0x20e3) return true;
  if (cp >= 0x2600 && cp <= 0x27bf) return true;
  if (cp >= 0x2b00 && cp <= 0x2bff) return true;
  if (cp >= 0x1f000 && cp <= 0x1ffff) return true;
  return false;
}

export function cleanText(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFC")) {
    if (!isJunkCodePoint(ch.codePointAt(0)!)) out += ch;
  }
  return out.replace(/\s+/g, " ").trim() || "Untitled";
}

// True for a code point a terminal interprets as part of a control or escape
// sequence: C0 controls (including ESC 0x1b and BEL 0x07), DEL 0x7f, and the C1
// controls 0x80-0x9f (which encode the 8-bit forms of CSI/OSC/ST).
function isControlCodePoint(cp: number): boolean {
  return cp <= 0x1f || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f);
}

// Strip control/escape-capable characters from a string that will be printed
// verbatim. Use this on attacker-influenced fields that bypass cleanText() —
// info hashes and magnet links — so a malicious or hijacked source can't smuggle
// e.g. an OSC-52 clipboard-write sequence to the terminal through them. Unlike
// cleanText(), it preserves the exact remaining characters (no whitespace
// collapsing, NFC folding, or "Untitled" fallback), which matters for
// identifiers and URLs.
export function stripControl(s: string): string {
  let out = "";
  for (const ch of s) {
    if (!isControlCodePoint(ch.codePointAt(0)!)) out += ch;
  }
  return out;
}

export function truncate(s: string, max: number): string {
  if (max <= 1) return s.slice(0, Math.max(0, max));
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
