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

// One dim status line for the trackers prompt: what is saved now, what the
// current field text will save, and how many typed tokens get dropped
// (bad scheme or duplicate), so a paste confirms itself before enter.
export function trackersStatus(saved: string[], fieldText: string): string {
  const next = parseTrackers(fieldText);
  const tokens = fieldText.split(/[\s,]+/).filter((t) => t.trim().length > 0);
  const ignored = tokens.length - next.length;
  const savedLabel = saved.length === 0 ? "none saved" : `${saved.length} saved`;
  const unchanged =
    ignored === 0 && next.length === saved.length && next.every((t, i) => t === saved[i]);
  if (unchanged) {
    return saved.length === 0
      ? "none saved · comma or space separated"
      : `${savedLabel} · comma or space separated · empty clears`;
  }
  if (tokens.length === 0) return `${savedLabel} → empty clears all`;
  let line = `${savedLabel} → will save ${next.length}`;
  if (ignored > 0) line += ` · ${ignored} ignored`;
  return line;
}
