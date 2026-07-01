import { buildMagnet } from "../magnet.js";
import { fetchViaProxies } from "../proxy.js";
import { unescapeEntities } from "../util.js";

const BASE = "https://nyaa.si/";

function tag(item, name) {
  const m = item.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?</${name}>`, "s"));
  return m?.[1]?.trim() ?? "";
}

function parseSize(s) {
  const m = s.trim().match(/^([\d.]+)\s*([KMGT]i?B)$/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  const mult = { KB: 1024, KIB: 1024, MB: 1024 ** 2, MIB: 1024 ** 2, GB: 1024 ** 3, GIB: 1024 ** 3, TB: 1024 ** 4, TIB: 1024 ** 4 };
  return Math.round(n * (mult[unit] ?? 1));
}

async function search(query) {
  const params = new URLSearchParams({ page: "rss", q: query.trim(), c: "0_0", f: "0" });
  const target = `${BASE}?${params.toString()}`;
  const res = await fetchViaProxies(target);
  const xml = await res.text();
  const out = [];
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

export const nyaa = {
  id: "nyaa",
  label: "Nyaa",
  tag: "NYAA",
  group: "Anime",
  homepage: "https://nyaa.si",
  search,
  viaProxy: true,
};
