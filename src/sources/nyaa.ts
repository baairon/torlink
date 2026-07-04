import { fetchResilient, HttpError, USER_AGENT } from "../util/net";
import { buildMagnet } from "./magnet";
import { unescapeEntities } from "./rss";
import { parseSize } from "../util/format";
import type { SearchOptions, Source, TorrentResult } from "./types";

const BASE = "https://nyaa.si/";

function tag(item: string, name: string): string {
  return item.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?</${name}>`, "s"))?.[1]?.trim() ?? "";
}

async function search(query: string, opts: SearchOptions = {}): Promise<TorrentResult[]> {
  const params = new URLSearchParams({ page: "rss", q: query.trim(), c: "0_0", f: "0" });
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
    const seeders = Number(tag(item, "nyaa:seeders"));
    const leechers = Number(tag(item, "nyaa:leechers"));
    const dateStr = tag(item, "pubDate");
    out.push({
      infoHash,
      name,
      sizeBytes: parseSize(tag(item, "nyaa:size")),
      seeders: Number.isFinite(seeders) ? seeders : 0,
      leechers: Number.isFinite(leechers) ? leechers : 0,
      source: "nyaa",
      magnet: buildMagnet(infoHash, name),
      added: dateStr ? new Date(dateStr).getTime() / 1000 : undefined,
    });
  }
  return out;
}

export const nyaa: Source = {
  id: "nyaa",
  label: "Nyaa",
  group: "Anime",
  homepage: "https://nyaa.si",
  search,
};
