(function () {
  window.Torlink = window.Torlink || {};
  Torlink.sources = Torlink.sources || {};
  const parseMagnet = Torlink.parseMagnet;
  const fetchViaProxies = Torlink.fetchViaProxies;

  const API = "https://subsplease.org/api/";
  const RES_PREFERENCE = ["1080", "720", "480"];

  function pickBest(downloads) {
    for (const res of RES_PREFERENCE) {
      const d = downloads.find((d) => d.res === res && d.magnet);
      if (d) return d;
    }
    return downloads.find((d) => d.magnet);
  }

  async function search(query) {
    const q = query.trim();
    const params = new URLSearchParams({ tz: "UTC" });
    if (q) {
      params.set("f", "search");
      params.set("s", q);
    } else {
      params.set("f", "latest");
    }

    const target = `${API}?${params.toString()}`;
    const res = await fetchViaProxies(target);
    const json = await res.json();
    if (!json || Array.isArray(json)) return [];

    const out = [];
    for (const entry of Object.values(json)) {
      const dl = pickBest(entry.downloads ?? []);
      if (!dl?.magnet) continue;
      const parsed = parseMagnet(dl.magnet);
      if (!parsed) continue;
      const show = entry.show ?? "Unknown";
      const ep = entry.episode ? ` - ${entry.episode}` : "";
      const sizeMatch = dl.magnet.match(/[?&]xl=(\d+)/);
      out.push({
        infoHash: parsed.infoHash,
        name: `${show}${ep} [${dl.res ?? "?"}p]`,
        sizeBytes: sizeMatch ? Number(sizeMatch[1]) : 0,
        seeders: 0,
        leechers: 0,
        source: "subsplease",
        magnet: parsed.magnet,
        added: entry.release_date ? new Date(entry.release_date).getTime() / 1000 : undefined,
      });
    }
    return out;
  }

  Torlink.sources.subsplease = {
    id: "subsplease",
    label: "SubsPlease",
    tag: "SUB",
    group: "Anime",
    homepage: "https://subsplease.org",
    search,
    viaProxy: true,
  };
})();
