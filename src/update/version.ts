import { fetchResilient, USER_AGENT, type FetchImpl } from "../util/net";
import { readManifest } from "./manifest";

// Compare two dotted versions numerically. Pre-release / build suffixes (-rc.1,
// +build) are dropped before comparing; torlink ships plain x.y.z releases, and
// a half-parsed suffix is worse than ignoring it. Returns <0, 0, >0 like a
// sort comparator (a older, equal, a newer).
export function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] =>
    v
      .trim()
      .replace(/^v/i, "")
      .split(/[-+]/, 1)[0]!
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function isNewer(current: string, candidate: string): boolean {
  return compareVersions(candidate, current) > 0;
}

// Ask the npm registry for the published version of whatever package this code
// ships in: the name comes from the manifest, never a hardcoded slug, so the
// comparison always runs against the real npm package. Works no matter how
// torlink was installed (npm, nix, a git checkout), since they all track the
// same release. Never throws: the caller is either a background banner or a
// one-shot command, and neither should care that the network was down.
export async function fetchLatestVersion(opts: {
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
  packageName?: string;
} = {}): Promise<string | null> {
  const { fetchImpl, timeoutMs = 4000 } = opts;
  const name = opts.packageName ?? readManifest()?.name;
  if (!name) return null;
  try {
    const res = await fetchResilient(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
      // One shot: this feeds a background banner and a re-runnable command, so a
      // flaky moment should fail soft, not sit through a backoff.
      retries: 0,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      fetchImpl,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
}
