(function () {
  const {
    SOURCES,
    runSearch,
    parseMagnet,
    createDownloader,
    isStreamingSupported,
    canFallbackStream,
    streamViaMediaSource,
    getProxyList,
    setProxyList,
    resetProxyList,
    DEFAULT_PROXIES,
    checkPeers,
    getCustomTrackers,
    setCustomTrackers,
    resetCustomTrackers,
    parseTrackers,
    formatTrackers,
  } = window.Torlink;

  const el = (id) => document.getElementById(id);

  const searchForm = el("search-form");
  const searchInput = el("search-input");
  const sourceStatusEl = el("source-status");
  const resultsList = el("results-list");
  const resultsEmpty = el("results-empty");
  const resultsTitle = el("results-title");
  const resultsSubtitle = el("results-subtitle");
  const downloadsList = el("downloads-list");
  const downloadsEmpty = el("downloads-empty");
  const seedsList = el("seeds-list");
  const seedsEmpty = el("seeds-empty");
  const downloadsBadge = el("downloads-badge");
  const seedsBadge = el("seeds-badge");
  const toast = el("toast");
  const settingsDialog = el("settings-dialog");
  const proxyInput = el("proxy-input");
  const trackersInput = el("trackers-input");
  const playerDialog = el("player-dialog");
  const playerTitle = el("player-title");
  const playerVideo = el("player-video");
  const playerStatus = el("player-status");

  let lastResults = [];
  let lastIsBrowse = false;

  function fmtBytes(n) {
    if (!n) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i += 1;
    }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
  }

  function fmtSpeed(n) {
    return n ? `${fmtBytes(n)}/s` : "";
  }

  function showToast(message, isError = false) {
    toast.textContent = message;
    toast.classList.toggle("err", isError);
    toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove("show"), 4000);
  }

  document.querySelectorAll(".rail-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".rail-item").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".section").forEach((s) => s.classList.remove("active"));
      btn.classList.add("active");
      el(`section-${btn.dataset.section}`).classList.add("active");
    });
  });

  function renderSourceStatus(statusMap) {
    sourceStatusEl.innerHTML = "";
    for (const source of SOURCES) {
      const st = statusMap.get(source.id) ?? { state: "idle" };
      const span = document.createElement("span");
      span.className = `tag ${st.state === "ok" ? "ok" : st.state === "err" ? "err" : st.state === "pending" ? "pending" : ""}`;
      const count = st.state === "ok" ? ` (${st.count})` : "";
      span.textContent = `${source.tag}${count}${st.state === "err" ? " ✗" : ""}`;
      if (st.state === "err") span.title = String(st.error?.message || st.error || "failed");
      sourceStatusEl.appendChild(span);
    }
  }

  function renderResults(results, isBrowse) {
    resultsList.innerHTML = "";
    resultsEmpty.style.display = results.length ? "none" : "block";
    const label = isBrowse ? "Latest" : "Results";
    resultsTitle.textContent = results.length ? `${label} (${results.length})` : label;
    resultsSubtitle.textContent = isBrowse && results.length ? "newest across all sources" : "";
    const sorted = isBrowse
      ? [...results].sort((a, b) => (b.added || 0) - (a.added || 0))
      : [...results].sort((a, b) => b.seeders - a.seeders);
    for (const r of sorted) {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `
        <div class="row-name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</div>
        <span class="row-tag">${r.source}</span>
        <span class="row-size">${fmtBytes(r.sizeBytes)}</span>
        <span class="row-seeds">↑${r.seeders}</span>
        <span class="row-leech">↓${r.leechers}</span>
      `;
      const actions = document.createElement("div");
      actions.className = "row-actions";
      const dlBtn = document.createElement("button");
      dlBtn.textContent = "Download";
      dlBtn.addEventListener("click", () => startDownload(r.magnet));
      const copyBtn = document.createElement("button");
      copyBtn.className = "btn-ghost";
      copyBtn.textContent = "Copy magnet";
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(r.magnet);
        showToast("Magnet copied");
      });
      const checkBtn = document.createElement("button");
      checkBtn.className = "btn-ghost";
      checkBtn.textContent = "👀 Check peers";
      checkBtn.title = "Query the WebSocket trackers for WebRTC-reachable peers, without downloading";
      checkBtn.addEventListener("click", async () => {
        checkBtn.disabled = true;
        checkBtn.textContent = "Checking…";
        const { peers, trackersResponded } = await checkPeers(r.magnet);
        if (!trackersResponded) {
          checkBtn.textContent = "No tracker response";
          checkBtn.title = "None of the WebSocket trackers answered in time — try again, or the swarm may be unreachable right now";
        } else if (peers > 0) {
          checkBtn.textContent = `✓ ${peers} peer${peers === 1 ? "" : "s"}`;
          checkBtn.classList.add("check-peers-found");
        } else {
          checkBtn.textContent = "✗ 0 peers";
          checkBtn.classList.add("check-peers-none");
        }
      });
      actions.append(dlBtn, copyBtn, checkBtn);
      row.appendChild(actions);
      resultsList.appendChild(row);
    }
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderDownloads(items) {
    const active = items.filter((i) => i.status !== "seeding");
    const seeding = items.filter((i) => i.status === "seeding");

    downloadsBadge.textContent = active.length || "";
    seedsBadge.textContent = seeding.length || "";

    downloadsList.innerHTML = "";
    downloadsEmpty.style.display = active.length ? "none" : "block";
    for (const item of active) downloadsList.appendChild(downloadRow(item));

    seedsList.innerHTML = "";
    seedsEmpty.style.display = seeding.length ? "none" : "block";
    for (const item of seeding) seedsList.appendChild(downloadRow(item));
  }

  let activeStreamCleanup = null;

  async function openPlayer(name, file) {
    playerTitle.textContent = name;
    playerStatus.textContent = "Starting stream…";
    playerVideo.removeAttribute("src");
    playerDialog.showModal();

    if (isStreamingSupported()) {
      try {
        await downloader.ensureStream();
        file.streamTo(playerVideo);
        playerStatus.textContent = "";
      } catch (err) {
        playerStatus.textContent = `Streaming unavailable: ${err.message || err}`;
      }
      return;
    }

    if (canFallbackStream(file.name)) {
      activeStreamCleanup = streamViaMediaSource(file, playerVideo, (msg) => {
        playerStatus.textContent = msg;
      });
      return;
    }

    playerStatus.textContent = "Streaming needs HTTPS or localhost (this page was opened via file://), and this file's format isn't playable without it.";
  }

  function closePlayer() {
    playerVideo.pause();
    playerVideo.removeAttribute("src");
    playerVideo.load();
    activeStreamCleanup?.destroy();
    activeStreamCleanup = null;
  }

  el("player-close").addEventListener("click", () => playerDialog.close());
  playerDialog.addEventListener("close", closePlayer);

  function downloadRow(item) {
    const row = document.createElement("div");
    row.className = "row dl-row";
    const pct = Math.round(item.progress * 100);
    const statusText =
      item.status === "error"
        ? `Error: ${item.error}`
        : item.status === "seeding"
          ? `Seeding · ↑${fmtSpeed(item.uploadSpeed)} · ${item.numPeers} peers`
          : item.status === "saving"
            ? "Saving…"
            : item.status === "stalled"
              ? `Connected but not responding · ${item.numPeers} peers — try Copy magnet in a real torrent client`
              : `${pct}% · ↓${fmtSpeed(item.downloadSpeed)} · ${item.numPeers} peers`;

    row.innerHTML = `
      <div class="dl-row-top">
        <div class="row-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
      </div>
      <div class="dl-meta">${fmtBytes(item.sizeBytes)} · ${statusText}</div>
      <div class="progress"><div class="progress-fill" style="width:${item.status === "seeding" ? 100 : pct}%"></div></div>
    `;
    if (item.status === "stalled") row.classList.add("dl-row-stalled");

    const actions = document.createElement("div");
    actions.className = "row-actions";

    if (item.status === "stalled") {
      const copyBtn = document.createElement("button");
      copyBtn.className = "btn-ghost";
      copyBtn.textContent = "Copy magnet";
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(item.magnet);
        showToast("Magnet copied");
      });
      actions.appendChild(copyBtn);
    }

    if (item.videoFiles.length === 1) {
      const playBtn = document.createElement("button");
      playBtn.textContent = "▶ Play";
      playBtn.addEventListener("click", () => openPlayer(item.videoFiles[0].name, item.videoFiles[0].file));
      actions.appendChild(playBtn);
    }

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn-ghost";
    removeBtn.textContent = item.status === "seeding" ? "Stop seeding" : "Cancel";
    removeBtn.addEventListener("click", () => downloader.remove(item.id));
    actions.appendChild(removeBtn);
    row.appendChild(actions);

    if (item.videoFiles.length > 1) {
      const list = document.createElement("div");
      list.className = "video-files";
      for (const vf of item.videoFiles) {
        const fileRow = document.createElement("div");
        fileRow.className = "video-file-row";
        const label = document.createElement("span");
        label.className = "row-name";
        label.title = vf.name;
        label.textContent = `${vf.name} · ${fmtBytes(vf.sizeBytes)}`;
        const playBtn = document.createElement("button");
        playBtn.textContent = "▶ Play";
        playBtn.addEventListener("click", () => openPlayer(vf.name, vf.file));
        fileRow.append(label, playBtn);
        list.appendChild(fileRow);
      }
      row.appendChild(list);
    }

    return row;
  }

  const downloader = createDownloader(renderDownloads);

  function startDownload(magnet) {
    try {
      downloader.addMagnet(magnet);
      showToast("Download started");
    } catch (err) {
      showToast(String(err.message || err), true);
    }
  }

  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = searchInput.value.trim();

    const magnet = value ? parseMagnet(value) : null;
    if (magnet) {
      startDownload(magnet.magnet);
      searchInput.value = "";
      return;
    }

    // An empty box browses the latest across every source, mirroring the CLI's own
    // "empty ↵ browse" — most source adapters already return their own "latest" feed
    // when given an empty query (ported from the CLI), this just needed to stop being
    // blocked before it ever reached them.
    const statusMap = new Map();
    lastResults = [];
    lastIsBrowse = !value;
    renderResults(lastResults, lastIsBrowse);
    renderSourceStatus(statusMap);

    runSearch(value, {
      onStatus: (source, state, count, error) => {
        statusMap.set(source.id, { state, count, error });
        renderSourceStatus(statusMap);
      },
      onResult: (source, results) => {
        lastResults = lastResults.concat(results);
        renderResults(lastResults, lastIsBrowse);
      },
      onDone: () => {},
    });
  });

  el("settings-btn").addEventListener("click", () => {
    proxyInput.value = getProxyList().join("\n");
    trackersInput.value = formatTrackers(getCustomTrackers());
    settingsDialog.showModal();
  });

  settingsDialog.querySelector("form").addEventListener("submit", () => {
    setProxyList(proxyInput.value.split("\n"));
    setCustomTrackers(parseTrackers(trackersInput.value));
  });

  el("proxy-reset").addEventListener("click", () => {
    resetProxyList();
    proxyInput.value = DEFAULT_PROXIES.join("\n");
  });

  el("trackers-reset").addEventListener("click", () => {
    resetCustomTrackers();
    trackersInput.value = "";
  });

  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file && file.name.endsWith(".torrent")) {
      downloader.addTorrentFile(file);
      showToast("Download started");
    }
  });

  renderSourceStatus(new Map());
  renderResults([]);
  renderDownloads([]);
})();
