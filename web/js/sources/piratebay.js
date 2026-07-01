import { buildMagnet } from "../magnet.js";
import { fetchViaProxies } from "../proxy.js";

const API = "https://apibay.org";
const MOVIE_CATS = new Set([201, 202, 207, 209]);
const TV_CATS = new Set([205, 208]);
const TOP_MOVIES = `${API}/precompiled/data_top100_207.json`;
const TOP_TV = `${API}/precompiled/data_top100_208.json`;
const ZERO_HASH = "0000000000000000000000000000000000000000";

function toResult(it, source) {
  const infoHash = (it.info_hash ?? "").toLowerCase();
  if (!infoHash || infoHash === ZERO_HASH || it.id === "0") return null;
  const name = it.name || "Unknown";
  const numFiles = Number(it.num_files);
  return {
    infoHash,
    name,
    sizeBytes: Number(it.size) || 0,
    seeders: Number(it.seeders) || 0,
    leechers: Number(it.leechers) || 0,
    numFiles: Number.isFinite(numFiles) && numFiles > 0 ? numFiles : undefined,
    source,
    magnet: buildMagnet(infoHash, name),
    added: Number(it.added) || undefined,
  };
}

async function fetchItems(url) {
  const res = await fetchViaProxies(url);
  const json = await res.json();
  return Array.isArray(json) ? json : [];
}

async function search(query, cats, browseUrl, source) {
  const q = query.trim();
  const items = await fetchItems(q ? `${API}/q.php?q=${encodeURIComponent(q)}` : browseUrl);
  const out = [];
  for (const it of items) {
    if (q && !cats.has(Number(it.category))) continue;
    const r = toResult(it, source);
    if (r) out.push(r);
  }
  return out;
}

export const tpbMovies = {
  id: "tpb-movies",
  label: "TPB",
  tag: "TPB",
  group: "Movies",
  homepage: "https://thepiratebay.org",
  search: (query) => search(query, MOVIE_CATS, TOP_MOVIES, "tpb-movies"),
  viaProxy: true,
};

export const tpbTv = {
  id: "tpb-tv",
  label: "TPB",
  tag: "TPB",
  group: "TV",
  homepage: "https://thepiratebay.org",
  search: (query) => search(query, TV_CATS, TOP_TV, "tpb-tv"),
  viaProxy: true,
};
