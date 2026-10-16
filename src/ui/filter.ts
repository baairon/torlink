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
    interface ParsedProp {
      field: string;
      op: string;
      valStr: string;
      numRef?: number;
      isInvalid?: boolean;
    }
    const props: ParsedProp[] = [];

    for (const t of rawTokens) {
      const match = t.match(/^(size|seeder|seeders|seed|leecher|leechers|leech|source|src):([><]=?)?(.*)$/);
      if (match) {
        const field = match[1]!;
        const op = match[2] || "=";
        const valStr = match[3]!;
        let numRef: number | undefined;
        let isInvalid = false;

        if (field.startsWith("size")) {
          numRef = parseSize(valStr);
          if (!valStr || (numRef === 0 && !/^0+(\.0+)?\s*(b|kb|mb|gb|tb|kib|mib|gib|tib)?$/i.test(valStr.trim()))) {
            isInvalid = true;
          }
        } else if (field.startsWith("seed") || field.startsWith("leech")) {
          numRef = parseInt(valStr, 10);
          if (isNaN(numRef)) isInvalid = true;
        }

        props.push({ field, op, valStr, numRef, isInvalid });
      } else {
        tokens.push(t);
      }
    }

    if (props.some((p) => p.isInvalid)) {
      return [];
    }

    if (props.length > 0) {
      filtered = filtered.filter((r) => {
        for (const p of props) {
          if (p.field.startsWith("src") || p.field.startsWith("source")) {
            if (!r.source.includes(p.valStr)) return false;
            continue;
          }

          let target: number;
          if (p.field.startsWith("size")) {
            target = r.sizeBytes;
          } else if (p.field.startsWith("seed")) {
            target = r.seeders;
          } else if (p.field.startsWith("leech")) {
            target = r.leechers;
          } else {
            continue;
          }

          const ref = p.numRef!;
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
      const normalizedText = tokens.join(" ");
      const scored = filtered.map((r) => {
        const name = r.name.toLowerCase();
        let score = 0;

        // Every token must be present
        const matchesAll = tokens.every((token) => name.includes(token));
        if (!matchesAll) return { r, score: 0 };

        score += 10; // Base score for matching all tokens

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
