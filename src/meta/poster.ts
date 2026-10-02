import { fetchResilient, USER_AGENT } from "../util/net";

// The only outbound image requests torlink makes. Poster URLs come back from a remote catalog, so
// the host list is enforced here as well as at the mapping boundary in cinemeta.ts: this module is
// exported and a future caller could hand it a URL that never went through mapMeta.
export const POSTER_HOSTS = [
  "images.metahub.space",
  "live.metahub.space",
  "m.media-amazon.com",
] as const;

const HOSTS: ReadonlySet<string> = new Set<string>(POSTER_HOSTS);

// Matches cinemeta's per-request budget. A poster is decoration on a row the cursor is sitting on;
// once the user has moved, the bytes are worthless however cheap they were.
const TIMEOUT_MS = 6000;

// The renditions we ask for are 8-40 KB. A megabyte is generous enough that no legitimate poster
// approaches it and tight enough that a hostile or misconfigured host cannot make a terminal app
// buffer an unbounded body.
const MAX_POSTER_BYTES = 1_048_576;

/** Pure: https, an allowlisted host, and no port or credentials smuggled into the authority. */
export function isAllowedPosterUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // hostname, not host: `new URL` has already lowercased and punycoded it, and comparing the whole
  // authority would let "images.metahub.space:8443" or a userinfo prefix past a naive match.
  return (
    parsed.protocol === "https:" &&
    parsed.port === "" &&
    parsed.username === "" &&
    parsed.password === "" &&
    HOSTS.has(parsed.hostname)
  );
}

/**
 * True only for a JFIF/EXIF start-of-image marker.
 *
 * Metahub answers WebP for some ids regardless of `?format=jpeg`, and a WebP body starts `RIFF`.
 * Sniffing rejects it here — jpeg-js would otherwise be handed bytes it will throw on, and a
 * thrown decode is a slower, noisier way to reach the same "no art" answer.
 */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

// A caller's cancellation and our own deadline are both reasons to stop; the request honours
// whichever fires first. Same shape as cinemeta's, kept local because it is three lines and this
// module has no other reason to depend on the metadata client.
function deadline(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

/**
 * Fetch poster bytes, or null for every failure there is.
 *
 * One retry, not cinemeta's zero and not the default five: the poster request is fired after the
 * metadata that named it already landed, so the row has demonstrably held the cursor long enough
 * to be worth a second attempt at a transient 502 — but not a third, by which time the user has
 * scrolled on.
 */
export async function fetchPosterBytes(
  url: string,
  opts: { signal?: AbortSignal } = {},
): Promise<Uint8Array | null> {
  if (!isAllowedPosterUrl(url)) return null;
  try {
    const res = await fetchResilient(url, {
      retries: 1,
      headers: { "User-Agent": USER_AGENT, Accept: "image/jpeg" },
      signal: deadline(opts.signal),
    });
    if (!res.ok) return null;

    // Refuse an oversized body before reading it. content-length is advisory and a chunked
    // response omits it entirely, so the real cap is the one after the read.
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_POSTER_BYTES) return null;

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_POSTER_BYTES) return null;
    return isJpeg(bytes) ? bytes : null;
  } catch {
    return null;
  }
}
