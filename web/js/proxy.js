(function () {
  window.Torlink = window.Torlink || {};
  const fetchTimeout = Torlink.fetchTimeout;

  const STORAGE_KEY = "torlink.corsProxies";
  // Ordered fallback chain — corsproxy.io is fast and reliable for most sources
  // but blocklists a few domains (nyaa.si among them); allorigins.win covers
  // those but is noticeably slower and occasionally times out on its own.
  const DEFAULT_PROXIES = ["https://corsproxy.io/?url=", "https://api.allorigins.win/raw?url="];

  function getProxyList() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_PROXIES;
    } catch {
      return DEFAULT_PROXIES;
    }
  }

  function setProxyList(prefixes) {
    const list = prefixes.map((p) => p.trim()).filter(Boolean);
    if (list.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    else localStorage.removeItem(STORAGE_KEY);
  }

  function resetProxyList() {
    localStorage.removeItem(STORAGE_KEY);
  }

  async function fetchViaProxies(targetUrl) {
    const prefixes = getProxyList();
    const errors = [];
    for (const prefix of prefixes) {
      try {
        const res = await fetchTimeout(prefix + encodeURIComponent(targetUrl));
        if (res.ok) return res;
        errors.push(`${prefix}: HTTP ${res.status}`);
      } catch (err) {
        errors.push(`${prefix}: ${err.message || err}`);
      }
    }
    throw new Error(`All proxies failed — ${errors.join("; ")}`);
  }

  Torlink.getProxyList = getProxyList;
  Torlink.setProxyList = setProxyList;
  Torlink.resetProxyList = resetProxyList;
  Torlink.fetchViaProxies = fetchViaProxies;
  Torlink.DEFAULT_PROXIES = DEFAULT_PROXIES;
})();
