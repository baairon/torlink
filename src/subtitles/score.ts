import { parseRelease } from "./parse";
import type { ParsedRelease, SubtitleCandidate } from "./types";

function normCodec(codec: string | undefined): string | undefined {
  return codec?.replace(/^x/, "h");
}

function score(video: ParsedRelease, cand: ParsedRelease): number {
  let n = 0;
  if (video.group && video.group === cand.group) n += 8;
  if (video.source && video.source === cand.source) n += 4;
  if (video.resolution && video.resolution === cand.resolution) n += 2;
  if (video.codec && normCodec(video.codec) === normCodec(cand.codec)) n += 1;
  return n;
}

export function pickBest(
  video: ParsedRelease,
  candidates: SubtitleCandidate[],
  lang: string,
): SubtitleCandidate | null {
  const wanted = lang.toLowerCase();
  const survivors: Array<{ cand: SubtitleCandidate; score: number }> = [];

  for (const cand of candidates) {
    if (cand.lang.toLowerCase() !== wanted) continue;
    const p = parseRelease(cand.releaseName);
    if (p.title !== video.title) continue;
    if (video.season !== undefined && video.episode !== undefined) {
      if (p.season !== video.season || p.episode !== video.episode) continue;
    }
    if (video.year !== undefined && p.year !== undefined && p.year !== video.year) continue;
    survivors.push({ cand, score: score(video, p) });
  }

  if (survivors.length === 0) return null;
  let best = survivors[0]!;
  for (const s of survivors) if (s.score > best.score) best = s;

  // Contract floor: no candidate at >= 2 means nothing is downloaded, TV and
  // movies alike (gestdown names carry group/resolution, so real matches clear it).
  return best.score >= 2 ? best.cand : null;
}
