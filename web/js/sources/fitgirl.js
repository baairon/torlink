(function () {
  window.Torlink = window.Torlink || {};
  Torlink.sources = Torlink.sources || {};
  const fetchViaProxies = Torlink.fetchViaProxies;
  const unescapeEntities = Torlink.unescapeEntities;

  const HOME = "https://fitgirl-repacks.site";

  function parseRssItems(xml) {
    const items = xml.split("<item>").slice(1);
    const out = [];
    for (const item of items) {
      const magnetMatch = item.match(/href="(magnet:\?xt=urn:btih:[^"]+)"/i);
      if (!magnetMatch) continue;
      const magnet = unescapeEntities(magnetMatch[1]);
      const infoHash = magnet.match(/urn:btih:([a-zA-Z0-9]+)/)?.[1]?.toLowerCase() ?? "";
      if (!infoHash) continue;

      const name = unescapeEntities(item.match(/<title>(.*?)<\/title>/)?.[1] ?? "Unknown Title");
      const addedStr = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? "";
      const added = addedStr ? new Date(addedStr).getTime() / 1000 : undefined;

      out.push({ infoHash, name, sizeBytes: 0, seeders: 0, leechers: 0, source: "fitgirl", magnet, added });
    }
    return out;
  }

  async function search(query) {
    const q = query.trim();
    const target = q ? `${HOME}/?s=${encodeURIComponent(q)}&feed=rss2` : `${HOME}/feed/`;
    const res = await fetchViaProxies(target);
    return parseRssItems(await res.text());
  }

  Torlink.sources.fitgirl = {
    id: "fitgirl",
    label: "FitGirl",
    tag: "FG",
    group: "Games",
    homepage: HOME,
    search,
    viaProxy: true,
  };
})();
