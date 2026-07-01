import { buildMagnet } from "../magnet.js";
import { fetchTimeout } from "../fetch.js";

const HOSTS = ["movies-api.accel.li", "yts.lt"];

async function fetchMovies(params) {
  let lastError;
  for (const host of HOSTS) {
    try {
      const res = await fetchTimeout(`https://${host}/api/v2/list_movies.json?${params.toString()}`);
      if (res.ok) return await res.json();
      lastError = new Error(`YTS returned ${res.status}`);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error("YTS unreachable");
}

async function search(query) {
  const q = query.trim();
  const params = new URLSearchParams({ limit: "50" });
  if (q) params.set("query_term", q);
  else params.set("sort_by", "date_added");

  const json = await fetchMovies(params);
  const out = [];
  for (const movie of json.data?.movies ?? []) {
    const base = movie.title_long || movie.title || "Unknown";
    for (const t of movie.torrents ?? []) {
      if (!t.hash) continue;
      const infoHash = t.hash.toLowerCase();
      const tag = [t.quality, t.type].filter(Boolean).join(" ");
      const name = tag ? `${base} [${tag}]` : base;
      out.push({
        infoHash,
        name,
        sizeBytes: t.size_bytes ?? 0,
        seeders: t.seeds ?? 0,
        leechers: t.peers ?? 0,
        source: "yts",
        magnet: buildMagnet(infoHash, name),
        added: movie.date_uploaded_unix,
      });
    }
  }
  return out;
}

export const yts = {
  id: "yts",
  label: "YTS",
  tag: "YTS",
  group: "Movies",
  homepage: "https://yts.gg",
  search,
};
