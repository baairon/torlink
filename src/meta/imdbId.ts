// IMDb id validation, with no dependency on any particular metadata provider.
//
// This lives apart from cinemeta.ts because the torrent sources need it too: YTS, EZTV and The
// Pirate Bay all carry an IMDb id on their rows, and validating it is their business whether or
// not a metadata client ever runs. Keeping these two functions here means the lower sources/
// layer never has to import the Cinemeta client to sanitise a field of its own payload.

// An IMDb id is interpolated into a URL *path*, so it is attacker-controlled routing input the
// moment it comes back from a remote catalog. Same class of rule as stripControl() in
// util/format: validate the value you are about to hand to another system, not the value you
// received. Anchored, digits only — "tt0133093/../../admin" and "tt0133093?x=1" both fail.
const IMDB_ID = /^tt\d{7,10}$/;

/**
 * Accept a remote value as an IMDb id only if it still looks like one after cleaning. Returns
 * undefined rather than throwing so callers can treat "no id" and "bad id" identically.
 */
export function normalizeImdbId(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().toLowerCase();
  // Series episodes arrive as "tt0944947:5:14"; the series id is the part before the first colon.
  const base = trimmed.split(":", 1)[0] ?? "";
  return IMDB_ID.test(base) ? base : undefined;
}

/**
 * Some sources (YTS, torrent indexes) carry the bare numeric IMDb id. Zero-pad to IMDb's minimum
 * width of seven, then run the same result-side validation — a caller could hand us anything.
 */
export function imdbFromNumeric(raw: unknown): string | undefined {
  const s = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^\d+$/.test(s)) return undefined;
  const candidate = `tt${s.padStart(7, "0")}`;
  return IMDB_ID.test(candidate) ? candidate : undefined;
}
