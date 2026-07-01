(function () {
  window.Torlink = window.Torlink || {};
  const parseMagnet = Torlink.parseMagnet;
  const TRACKERS = Torlink.TRACKERS;
  const canFallbackStream = Torlink.canFallbackStream;
  const WebTorrent = window.WebTorrent;

  // WebTorrent's default browser chunk store is IndexedDB-backed — but IndexedDB requests
  // never resolve (no onsuccess, no onerror, just hangs) under file://, which eventually
  // surfaces as an unrelated-looking "unsafe file access" SecurityError. Swap in a plain
  // in-memory store (matching the standard abstract-chunk-store interface) specifically for
  // file:// — no persistence across reloads and higher memory use for large files, but it's
  // the only thing that actually works there. Real http(s) deployments keep the better default.
  class MemoryChunkStore {
    constructor(chunkLength) {
      this.chunkLength = chunkLength;
      this.chunks = [];
    }
    put(index, buf, cb) {
      this.chunks[index] = buf;
      cb?.(null);
    }
    get(index, opts, cb) {
      if (typeof opts === "function") {
        cb = opts;
        opts = {};
      }
      const buf = this.chunks[index];
      if (!buf) return cb(new Error("Chunk not found"));
      const start = opts?.offset || 0;
      const end = opts?.length ? start + opts.length : buf.length;
      cb(null, start === 0 && end === buf.length ? buf : buf.slice(start, end));
    }
    close(cb) {
      cb?.(null);
    }
    destroy(cb) {
      this.chunks = [];
      cb?.(null);
    }
  }

  const IS_FILE_PROTOCOL = location.protocol === "file:";
  const STALL_TIMEOUT_MS = 25_000;

  // Recomputed per-add (not a static const) since the user's custom tracker list
  // (Settings) can change between downloads. Only wss:// custom entries actually do
  // anything in a browser — udp/http(s)/ws are accepted for parity with the CLI's
  // validation but silently useless here, same as any non-wss tracker already is.
  function buildAddOpts() {
    const custom = Torlink.getCustomTrackers();
    return {
      announce: [...TRACKERS, ...custom],
      ...(IS_FILE_PROTOCOL ? { store: MemoryChunkStore } : {}),
    };
  }

  const VIDEO_EXTENSIONS = [".mp4", ".mkv", ".webm", ".mov", ".m4v", ".avi"];

  function isStreamingSupported() {
    return "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost");
  }

  function findVideoFiles(torrent) {
    const swAvailable = isStreamingSupported();
    return (torrent.files ?? [])
      .filter((f) => VIDEO_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext)))
      .filter((f) => swAvailable || canFallbackStream(f.name))
      .map((file) => ({ file, name: file.name, sizeBytes: file.length }));
  }

  async function saveFile(file) {
    const blob = await file.blob();
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: file.name });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (err) {
        if (err?.name === "AbortError") return;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  function createDownloader(onChange) {
    const client = new WebTorrent();
    const items = new Map();
    const pendingNames = new Map();
    let streamServerPromise = null;

    function ensureStream() {
      if (!isStreamingSupported()) return Promise.reject(new Error("Streaming needs HTTPS or localhost"));
      if (!streamServerPromise) {
        streamServerPromise = (async () => {
          const reg = await navigator.serviceWorker.register("sw.min.js", { scope: "/" });
          await navigator.serviceWorker.ready;
          client.createServer({ controller: reg });
        })();
      }
      return streamServerPromise;
    }

    function snapshot() {
      return [...items.values()];
    }

    function notify() {
      onChange(snapshot());
    }

    function attach(torrent, name) {
      const id = torrent.infoHash;
      if (items.has(id)) return items.get(id);

      const item = {
        id,
        name: name || torrent.name || id,
        sizeBytes: torrent.length || 0,
        progress: 0,
        downloadSpeed: 0,
        uploadSpeed: 0,
        numPeers: 0,
        status: "downloading",
        magnet: torrent.magnetURI,
        error: null,
        videoFiles: findVideoFiles(torrent),
        firstPeerAt: null,
      };
      items.set(id, item);
      notify();

      torrent.on("metadata", () => {
        item.videoFiles = findVideoFiles(torrent);
        notify();
      });

      torrent.on("done", async () => {
        item.status = "saving";
        item.progress = 1;
        notify();
        try {
          for (const file of torrent.files) await saveFile(file);
          item.status = "seeding";
        } catch (err) {
          item.status = "error";
          item.error = String(err?.message || err);
        }
        notify();
      });

      torrent.on("error", (err) => {
        item.status = "error";
        item.error = String(err?.message || err);
        notify();
      });

      torrent.on("noPeers", () => notify());

      return item;
    }

    setInterval(() => {
      let changed = false;
      for (const torrent of client.torrents) {
        if (!items.has(torrent.infoHash)) {
          attach(torrent, pendingNames.get(torrent.infoHash));
          pendingNames.delete(torrent.infoHash);
          changed = true;
        }
        const item = items.get(torrent.infoHash);
        if (!item || item.status === "error") continue;
        item.progress = torrent.progress;
        item.downloadSpeed = torrent.downloadSpeed;
        item.uploadSpeed = torrent.uploadSpeed;
        item.numPeers = torrent.numPeers;
        item.sizeBytes = torrent.length || item.sizeBytes;
        item.name = torrent.name || item.name;

        if (item.status === "downloading" || item.status === "stalled") {
          if (torrent.numPeers > 0 && !item.firstPeerAt) item.firstPeerAt = Date.now();
          if (torrent.numPeers === 0) item.firstPeerAt = null;
          const stuck =
            item.firstPeerAt && !torrent.ready && torrent.progress === 0 && Date.now() - item.firstPeerAt > STALL_TIMEOUT_MS;
          item.status = stuck ? "stalled" : "downloading";
        }

        changed = true;
      }
      if (changed) notify();
    }, 500);

    function addMagnet(magnet) {
      const parsed = parseMagnet(magnet);
      if (!parsed) throw new Error("Not a valid magnet link");
      if (items.has(parsed.infoHash)) throw new Error("Already in your downloads");
      pendingNames.set(parsed.infoHash, parsed.name);
      client.add(parsed.magnet, buildAddOpts(), (torrent) => attach(torrent, parsed.name));
    }

    function addTorrentFile(file) {
      client.add(file, buildAddOpts(), (torrent) => attach(torrent, file.name));
    }

    function remove(id) {
      const torrent = client.torrents.find((t) => t.infoHash === id);
      if (torrent) torrent.destroy();
      items.delete(id);
      notify();
    }

    return { addMagnet, addTorrentFile, remove, snapshot, ensureStream };
  }

  Torlink.isStreamingSupported = isStreamingSupported;
  Torlink.createDownloader = createDownloader;
  Torlink.MemoryChunkStore = MemoryChunkStore;
  Torlink.IS_FILE_PROTOCOL = IS_FILE_PROTOCOL;
})();
