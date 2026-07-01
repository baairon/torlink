(function () {
  window.Torlink = window.Torlink || {};

  // Ported from the CLI's src/config/trackers.ts to keep validation/parsing behavior
  // aligned between the two — same scheme allowlist, same dedup, same split rule.
  const STORAGE_KEY = "torlink.customTrackers";
  const VALID_SCHEME = /^(udp|https?|wss?):\/\//i;

  function parseTrackers(input) {
    const seen = new Set();
    const out = [];
    for (const raw of input.split(/[\s,]+/)) {
      const url = raw.trim();
      if (!url || !VALID_SCHEME.test(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
    return out;
  }

  function formatTrackers(trackers) {
    return trackers.join(", ");
  }

  function getCustomTrackers() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function setCustomTrackers(trackers) {
    if (trackers.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(trackers));
    else localStorage.removeItem(STORAGE_KEY);
  }

  function resetCustomTrackers() {
    localStorage.removeItem(STORAGE_KEY);
  }

  Torlink.parseTrackers = parseTrackers;
  Torlink.formatTrackers = formatTrackers;
  Torlink.getCustomTrackers = getCustomTrackers;
  Torlink.setCustomTrackers = setCustomTrackers;
  Torlink.resetCustomTrackers = resetCustomTrackers;
})();
