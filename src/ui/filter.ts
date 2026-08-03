import { getSource } from "../sources/registry";
import type { TorrentResult } from "../sources/types";

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
    const tokens = text.split(/\s+/);
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

  return filtered;
}
