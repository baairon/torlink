import { buildMagnet } from "../magnet.js";
import { fetchTimeout } from "../fetch.js";

async function search(query) {
  const q = query.trim() || "tv show";
  const params = new URLSearchParams({ q });
  const res = await fetchTimeout(`https://bitsearch.eu/api/v1/search?${params.toString()}`);
  if (!res.ok) throw new Error(`SolidTorrents returned ${res.status}`);
  const json = await res.json();

  const out = [];
  for (const item of json.results ?? []) {
    if (!item.infohash) continue;
    const infoHash = item.infohash.toLowerCase();
    const name = item.title || "Unknown";
    const added = item.updatedAt ? Math.floor(new Date(item.updatedAt).getTime() / 1000) : undefined;
    out.push({
      infoHash,
      name,
      sizeBytes: item.size ?? 0,
      seeders: item.seeders ?? 0,
      leechers: item.leechers ?? 0,
      source: "solid",
      magnet: buildMagnet(infoHash, name),
      added,
    });
  }
  return out;
}

export const solid = {
  id: "solid",
  label: "Solid",
  tag: "SLD",
  group: "TV",
  homepage: "https://bitsearch.eu",
  search,
};
