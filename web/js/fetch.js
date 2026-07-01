(function () {
  window.Torlink = window.Torlink || {};

  async function fetchTimeout(url, ms = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(url, { signal: controller.signal });
    } catch (err) {
      if (err.name === "AbortError") throw new Error("Timed out");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  Torlink.fetchTimeout = fetchTimeout;
})();
