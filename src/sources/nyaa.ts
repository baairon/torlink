import { fetchResilient, HttpError, USER_AGENT } from "../util/net";
import { buildMagnet } from "./magnet";
import { unescapeEntities } from "./rss";
import { parseSize, parseUnixSeconds } from "../util/format";
import type { SearchOptions, Source, SourceId, TorrentResult } from "./types";

const BASE = "https://nyaa.si/";
const AUDIO_FILTER = /\b(mp3|flac|aac|lossless|ost|soundtrack|drama cd|audiobook|audiobooks)\b/i;

function tag(item: string, name: string): string {
  return item.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?</${name}>`, "s"))?.[1]?.trim() ?? "";
}

async function search(
  query: string,
  cat = "0_0",
  sourceId: SourceId = "nyaa",
  opts: SearchOptions = {},
): Promise<TorrentResult[]> {
  const params = new URLSearchParams({ page: "rss", q: query.trim(), c: cat, f: "0" });
  const res = await fetchResilient(`${BASE}?${params.toString()}`, {
    headers: { "User-Agent": USER_AGENT },
    signal: opts.signal,
  });
  if (!res.ok) throw new HttpError(res.status, `Nyaa returned ${res.status}`);

  const xml = await res.text();
  const out: TorrentResult[] = [];
  for (const item of xml.split("<item>").slice(1)) {
    const infoHash = tag(item, "nyaa:infoHash").toLowerCase();
    const name = unescapeEntities(tag(item, "title"));
    if (!infoHash || !name) continue;

    // Filter out audio/drama CD releases when querying E-Books
    if (sourceId === "nyaa-ebooks" && AUDIO_FILTER.test(name)) continue;

    const seeders = Number(tag(item, "nyaa:seeders"));
    const leechers = Number(tag(item, "nyaa:leechers"));
    const dateStr = tag(item, "pubDate");
    out.push({
      infoHash,
      name,
      sizeBytes: parseSize(tag(item, "nyaa:size")),
      seeders: Number.isFinite(seeders) ? seeders : 0,
      leechers: Number.isFinite(leechers) ? leechers : 0,
      source: sourceId,
      magnet: buildMagnet(infoHash, name),
      added: parseUnixSeconds(dateStr),
    });
  }
  return out;
}

export const nyaa: Source = {
  id: "nyaa",
  label: "Nyaa",
  groups: ["Anime"],
  homepage: "https://nyaa.si",
  reportsHealth: true,
  search: (query, opts = {}) => search(query, "1_0", "nyaa", opts),
};

export const nyaaEbooks: Source = {
  id: "nyaa-ebooks",
  label: "Nyaa",
  groups: ["E-Books"],
  homepage: "https://nyaa.si",
  reportsHealth: true,
  search: (query, opts = {}) => search(query, "3_0", "nyaa-ebooks", opts),
};
