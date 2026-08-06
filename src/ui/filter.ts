import { getSource } from "../sources/registry";
import type { TorrentResult } from "../sources/types";
import { parseSize } from "../util/format";

export function filterResults(
  list: TorrentResult[],
  hideDead: boolean,
  textFilter: string = "",
): TorrentResult[] {
  let filtered = list;

  if (hideDead) {
    // Sources without swarm data report seeders: 0 for everything (unknown, not
    // dead), so the filter only judges rows whose source actually reports health.
    filtered = filtered.filter((r) => r.seeders > 0 || !getSource(r.source).reportsHealth);
  }

  const text = textFilter.trim().toLowerCase();
  if (text) {
    const rawTokens = text.split(/\s+/);
    const tokens: string[] = [];
    const props: { field: string; op: string; val: string }[] = [];

    for (const t of rawTokens) {
      const match = t.match(/^(size|seeder|seeders|seed|leecher|leechers|leech|source|src):([><]=?)?(.*)$/);
      if (match) {
        props.push({ field: match[1]!, op: match[2] || "=", val: match[3]! });
      } else {
        tokens.push(t);
      }
    }

    if (props.length > 0) {
      filtered = filtered.filter((r) => {
        for (const p of props) {
          const valStr = p.val;
          let target: number;
          let ref: number;

          if (p.field.startsWith("size")) {
            target = r.sizeBytes;
            ref = parseSize(valStr);
          } else if (p.field.startsWith("seed")) {
            target = r.seeders;
            ref = parseInt(valStr, 10);
            if (isNaN(ref)) return false;
          } else if (p.field.startsWith("leech")) {
            target = r.leechers;
            ref = parseInt(valStr, 10);
            if (isNaN(ref)) return false;
          } else if (p.field.startsWith("src") || p.field.startsWith("source")) {
            if (!r.source.includes(valStr)) return false;
            continue;
          } else {
            continue;
          }

          if (p.op === ">" && !(target > ref)) return false;
          if (p.op === ">=" && !(target >= ref)) return false;
          if (p.op === "<" && !(target < ref)) return false;
          if (p.op === "<=" && !(target <= ref)) return false;
          if (p.op === "=" && !(target === ref)) return false;
        }
        return true;
      });
    }

    if (tokens.length > 0) {
      const scored = filtered.map((r) => {
        const name = r.name.toLowerCase();
        let score = 0;

        // Every token must be present
        const matchesAll = tokens.every((token) => name.includes(token));
        if (!matchesAll) return { r, score: 0 };

        score += 10; // Base score for matching all tokens

        const normalizedText = tokens.join(" ");
        if (name.includes(normalizedText)) {
          score += 50; // Exact substring gets highest boost
        } else {
          // Boost if tokens appear in the same order
          let lastIndex = -1;
          let inOrder = true;
          for (const token of tokens) {
            const idx = name.indexOf(token, lastIndex + 1);
            if (idx === -1 || idx < lastIndex) {
              inOrder = false;
              break;
            }
            lastIndex = idx;
          }
          if (inOrder) score += 20;
        }

        return { r, score };
      });

      filtered = scored
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.r);
    }
  }

  return filtered;
}
