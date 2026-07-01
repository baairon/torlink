const VALID_SCHEME = /^(udp|https?|wss?):\/\//i;

export function parseTrackers(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[\s,]+/)) {
    const url = raw.trim();
    if (!url || !VALID_SCHEME.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

export function formatTrackers(trackers: string[]): string {
  return trackers.join(", ");
}
