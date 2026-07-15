// Discord embeds for the slash-command replies and the notifications. Kept as
// plain builders (no I/O) so they're easy to test and the daemon just hands the
// result to Discord. Colours track torlink's palette: violet for neutral, the
// logo's sprout-green for success, a soft red for failure.

import { cleanText, formatBytes, truncate } from "../util/format";
import { VERSION } from "../version";
import type { TorrentResult } from "../sources/types";

const VIOLET = 0x7c5cd6;
const GREEN = 0x5ae87a;
const RED = 0xe0555a;

export const SELECT_ADD_ID = "torlnk:add";
export const PAGE_PREV_ID = "torlnk:prev";
export const PAGE_NEXT_ID = "torlnk:next";
export const PAGE_SIZE = 10;
// Browse the healthiest matches without letting one search balloon in memory.
export const MAX_RESULTS = 50;

export interface Embed {
  color?: number;
  title?: string;
  description?: string;
  footer?: { text: string };
  timestamp?: string;
}

export interface DownloadRow {
  name: string;
  status: string;
  progress: number;
}
export interface SeedRow {
  name: string;
  status: string;
}

export function helpEmbed(): Embed {
  return {
    color: VIOLET,
    title: "🧲 torlink",
    description: [
      "Terminal-native torrent search, right here in Discord.",
      "",
      "**/search** `query` searches every source at once",
      "**/add** `number or magnet` downloads a result, or a pasted magnet",
      "**/status** shows active downloads and seeds",
      "**/cancel** `number` stops a download from /status",
    ].join("\n"),
    footer: { text: `torlink v${VERSION}` },
  };
}

// n is the 1-based number the user sees (global across pages), so /add <n> and
// the dropdown always agree.
function resultLine(r: TorrentResult, n: number): string {
  const size = r.sizeBytes ? formatBytes(r.sizeBytes) : "size unknown";
  return `**${n}.** ${truncate(cleanText(r.name), 88)}\n\`${size}\` · 🌱 **${r.seeders}** · ${r.source}`;
}

export function searchEmbed(
  query: string,
  window: TorrentResult[],
  total: number,
  startIndex: number,
  category: string | undefined,
  page: number,
  totalPages: number,
): Embed {
  const title = `🔎 ${category ? `${category} · ` : ""}${truncate(query, 80)}`;
  if (window.length === 0) {
    return {
      color: VIOLET,
      title,
      description: category
        ? "No results in this category. Try All sources, or different words."
        : "No results. Try different words.",
    };
  }
  return {
    color: VIOLET,
    title,
    description: window.map((r, i) => resultLine(r, startIndex + i + 1)).join("\n\n"),
    footer: { text: `Page ${page + 1}/${totalPages} · ${total} results · pick below, or /add <number>` },
  };
}

// The page's dropdown (one click to download) plus prev/next buttons when there's
// more than one page. Values are info hashes, which are short and page-independent.
export function searchComponents(
  window: TorrentResult[],
  startIndex: number,
  page: number,
  totalPages: number,
): unknown[] | undefined {
  if (window.length === 0) return undefined;
  const rows: unknown[] = [
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: SELECT_ADD_ID,
          placeholder: "⬇️  Download a result…",
          options: window.map((r, i) => ({
            label: truncate(`${startIndex + i + 1}. ${cleanText(r.name)}`, 95),
            description: truncate(
              `${r.sizeBytes ? formatBytes(r.sizeBytes) : "?"} · ${r.seeders} seeders · ${r.source}`,
              95,
            ),
            value: r.infoHash,
          })),
        },
      ],
    },
  ];
  if (totalPages > 1) {
    rows.push({
      type: 1,
      components: [
        { type: 2, style: 2, custom_id: PAGE_PREV_ID, label: "◀ Prev", disabled: page <= 0 },
        { type: 2, style: 2, custom_id: "torlnk:pageinfo", label: `Page ${page + 1} / ${totalPages}`, disabled: true },
        { type: 2, style: 2, custom_id: PAGE_NEXT_ID, label: "Next ▶", disabled: page >= totalPages - 1 },
      ],
    });
  }
  return rows;
}

function progressBar(pct: number): string {
  const slots = 12;
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * slots);
  return "▰".repeat(filled) + "▱".repeat(slots - filled);
}

export function statusEmbed(downloads: DownloadRow[], seeds: SeedRow[]): Embed {
  if (downloads.length === 0 && seeds.length === 0) {
    return { color: VIOLET, title: "📊 Status", description: "Nothing downloading or seeding right now." };
  }
  const parts: string[] = [];
  if (downloads.length) {
    parts.push("**Downloads**");
    downloads.forEach((d, i) => {
      const tail = d.status === "downloading" ? `${progressBar(d.progress)}  ${d.progress}%` : `_${d.status}_`;
      parts.push(`\`${i + 1}\` ${truncate(cleanText(d.name), 66)}\n${tail}`);
    });
  }
  if (seeds.length) {
    if (parts.length) parts.push("");
    parts.push("**Seeding**");
    seeds.forEach((s) => parts.push(`🌱 ${truncate(cleanText(s.name), 66)} · _${s.status}_`));
  }
  return { color: VIOLET, title: "📊 Status", description: parts.join("\n") };
}

export function addedEmbed(outcome: "added" | "duplicate" | "invalid", name: string): Embed {
  if (outcome === "added") {
    return { color: GREEN, title: "⬇️  Download started", description: truncate(cleanText(name), 200) };
  }
  if (outcome === "duplicate") {
    return { color: VIOLET, title: "Already in the queue", description: truncate(cleanText(name), 200) };
  }
  return { color: RED, title: "Couldn't add that", description: "Not a valid result number, magnet link, or info hash." };
}

export function cancelledEmbed(name: string): Embed {
  return { color: VIOLET, title: "✖️  Cancelled", description: truncate(cleanText(name), 200) };
}

export function errorEmbed(text: string): Embed {
  return { color: RED, description: text };
}

export function finishedEmbed(name: string): Embed {
  return {
    color: GREEN,
    title: "✅ Download complete",
    description: truncate(cleanText(name), 200),
    timestamp: new Date().toISOString(),
  };
}

export function failedEmbed(name: string, error?: string): Embed {
  const desc = truncate(cleanText(name), 180) + (error ? `\n\`${truncate(error, 120)}\`` : "");
  return { color: RED, title: "⚠️ Download failed", description: desc, timestamp: new Date().toISOString() };
}
