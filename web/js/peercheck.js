import WebTorrent from "../vendor/webtorrent.min.js";
import { parseMagnet, TRACKERS } from "./magnet.js";

// Only one of our three trackers (tracker.btorrent.xyz) reliably answers a
// scrape query — verified live, and independently confirmed against
// ngosang/trackerslist's full public WebSocket-tracker list, which itself
// lists only that one tracker. The other two do answer plain `announce`
// though (part of every torrent add, no extra call needed), so this checks
// both signals and reports whichever finds more.
const PROBE_TIMEOUT_MS = 12_000;
const GRACE_AFTER_FIRST_SIGNAL_MS = 1_500;

let probeClient = null;
function getProbeClient() {
  if (!probeClient) probeClient = new WebTorrent();
  return probeClient;
}

export function checkPeers(magnet) {
  return new Promise((resolve) => {
    const parsed = parseMagnet(magnet);
    if (!parsed) {
      resolve({ peers: 0, trackersResponded: 0 });
      return;
    }

    const client = getProbeClient();
    const scrapeResults = [];
    let liveNumPeers = 0;
    let settled = false;
    let torrent = null;
    let scrapeSent = false;
    let graceTimer = null;

    function report() {
      const scraped = scrapeResults.length ? Math.max(...scrapeResults.map((r) => (r.complete || 0) + (r.incomplete || 0))) : 0;
      return { peers: Math.max(scraped, liveNumPeers), trackersResponded: scrapeResults.length };
    }

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      clearInterval(poll);
      resolve(report());
      if (torrent) torrent.destroy();
    }

    function signalReceived() {
      // A fast *negative* response (scrape often answers in <1s with 0) must not cut off
      // the slower trackers' announce-based peer discovery, which can take several more
      // seconds — only a positive signal should trigger the early-exit countdown.
      if (report().peers > 0 && !graceTimer) {
        graceTimer = setTimeout(finish, GRACE_AFTER_FIRST_SIGNAL_MS);
      }
    }

    const timer = setTimeout(finish, PROBE_TIMEOUT_MS);

    const poll = setInterval(() => {
      if (!torrent) {
        torrent = client.torrents.find((t) => t.infoHash === parsed.infoHash) || null;
        if (!torrent) return;
      }

      if (torrent.numPeers !== liveNumPeers) {
        liveNumPeers = torrent.numPeers;
        signalReceived();
      }

      if (!scrapeSent) {
        const tracker = torrent.discovery && torrent.discovery.tracker;
        if (!tracker) return;
        scrapeSent = true;
        tracker.on("scrape", (data) => {
          if (data.infoHash !== torrent.infoHash) return;
          scrapeResults.push(data);
          signalReceived();
        });
        tracker.on("warning", () => {});
        tracker.scrape();
      }
    }, 200);

    client.add(parsed.magnet, { announce: TRACKERS });
  });
}
