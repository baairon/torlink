import { getSource } from "../sources/registry";
import type { SourceId } from "../sources/types";
import { parseRelease } from "./parse";

// Decides whether a finished download is worth a subtitle search. Games and
// Anime sources are always out (no provider covers them); otherwise the
// release name decides, with a Movies-source fallback for year-less names
// (title-only movie search still works). Season alone is enough for tv: a
// season pack's torrent name has no episode, the per-file parse supplies it.
export function classifyForSubtitles(
  source: SourceId | undefined,
  name: string,
): "tv" | "movie" | null {
  const groups = source ? (getSource(source).groups ?? []) : [];
  if (groups.includes("Games") || groups.includes("Anime")) return null;
  const p = parseRelease(name);
  if (p.season !== undefined) return "tv";
  if (p.year !== undefined) return "movie";
  return groups.includes("Movies") ? "movie" : null;
}
