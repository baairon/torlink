// Parse a short human duration like "1h", "30m", "90s", "2d" into milliseconds.
// A bare number is seconds. Returns null for anything unparseable.
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase();
  const m = /^(\d+)(s|m|h|d)?$/.exec(s);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  const unit = m[2] ?? "s";
  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]!;
  return n * mult;
}
