(function () {
  window.Torlink = window.Torlink || {};
  Torlink.sources = Torlink.sources || {};
  const buildMagnet = Torlink.buildMagnet;
  const fetchTimeout = Torlink.fetchTimeout;

  const API = "https://eztvx.to/api/get-torrents";

  async function search(query) {
    const res = await fetchTimeout(`${API}?limit=100&page=1`);
    if (!res.ok) throw new Error(`EZTV returned ${res.status}`);
    const json = await res.json();
    const q = query.trim().toLowerCase();

    const out = [];
    for (const t of json.torrents ?? []) {
      const hash = (t.hash ?? "").toLowerCase();
      const name = t.title || t.filename || hash;
      const magnet = t.magnet_url || (hash ? buildMagnet(hash, name) : "");
      if (!magnet || !hash) continue;
      if (q && !name.toLowerCase().includes(q)) continue;
      out.push({
        infoHash: hash,
        name,
        sizeBytes: Number(t.size_bytes ?? 0) || 0,
        seeders: t.seeds ?? 0,
        leechers: t.peers ?? 0,
        source: "eztv",
        magnet,
        added: t.date_released_unix,
      });
    }
    return out;
  }

  Torlink.sources.eztv = {
    id: "eztv",
    label: "EZTV",
    tag: "EZTV",
    group: "TV",
    homepage: "https://eztvx.to",
    search,
  };
})();
