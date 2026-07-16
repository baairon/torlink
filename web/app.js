const TOKEN_KEY = "torzlinkServeToken";

/** Mirror of src/ui/lib/theme.ts SOURCE_STYLE + COLOR */
const SOURCE_STYLE = {
  fitgirl: { tag: "FG", color: "#38bdf8" },
  yts: { tag: "YTS", color: "#86d6a2" },
  eztv: { tag: "EZTV", color: "#f0c560" },
  nyaa: { tag: "NYAA", color: "#7dd3fc" },
  subsplease: { tag: "SUB", color: "#6eb5e8" },
  "tpb-movies": { tag: "TPB", color: "#5fd0c5" },
  "tpb-tv": { tag: "TPB", color: "#5fd0c5" },
  "x1337-movies": { tag: "1337", color: "#f6a55c" },
  "x1337-tv": { tag: "1337", color: "#f6a55c" },
};

/** Mirror of src/sources/categories.ts */
const CATEGORIES = [
  { key: "all", label: "All" },
  { key: "games", label: "Games", group: "Games" },
  { key: "movies", label: "Movies", group: "Movies" },
  { key: "tv", label: "TV", group: "TV" },
  { key: "anime", label: "Anime", group: "Anime" },
];

const resultsEl = document.getElementById("results");
const queueEl = document.getElementById("queue");
const historyEl = document.getElementById("history");
const seedsEl = document.getElementById("seeds");
const searchStatus = document.getElementById("search-status");
const searchForm = document.getElementById("search-form");
const magnetForm = document.getElementById("magnet-form");
const authGate = document.getElementById("auth-gate");
const authForm = document.getElementById("auth-form");
const mainLayout = document.getElementById("main");
const netSwitch = document.getElementById("net-switch");
const netSwitchState = document.getElementById("net-switch-state");
const netStatusEl = document.getElementById("net-status");
const brandModeLabel = document.getElementById("brand-mode-label");
const categoryTabs = document.getElementById("category-tabs");
const hideDeadEl = document.getElementById("hide-dead");
const sortFieldEl = document.getElementById("sort-field");
const historyClearBtn = document.getElementById("history-clear");
const configForm = document.getElementById("config-form");
const configDownloadDir = document.getElementById("config-download-dir");
const configTrackers = document.getElementById("config-trackers");
const configStatus = document.getElementById("config-status");

let currentNetMode = "direct";
let activeCategory = "all";
let activeLibTab = "queue";
let lastQuery = "";
let configDirLocked = false;

function sourceStyle(id) {
  return SOURCE_STYLE[id] || { tag: "•", color: "#6eb5e8" };
}

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

function setToken(t) {
  if (t) sessionStorage.setItem(TOKEN_KEY, t);
  else sessionStorage.removeItem(TOKEN_KEY);
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

function formatSpeed(n) {
  if (!n) return "0 B/s";
  return `${formatBytes(n)}/s`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatEta(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "";
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${Math.round(sec / 3600)}h`;
}

async function api(path, options) {
  const headers = { "content-type": "application/json", ...options?.headers };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, {
    ...options,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    setToken("");
    showAuth(true);
    throw new Error("Token requerido o inválido");
  }
  if (!res.ok) throw new Error(data.error || res.statusText || "request failed");
  return data;
}

function setStatus(text) {
  if (!text) {
    searchStatus.hidden = true;
    searchStatus.textContent = "";
    return;
  }
  searchStatus.hidden = false;
  searchStatus.textContent = `❯ ${text}`;
}

function setConfigStatus(text) {
  if (!configStatus) return;
  if (!text) {
    configStatus.hidden = true;
    configStatus.textContent = "";
    return;
  }
  configStatus.hidden = false;
  configStatus.textContent = `❯ ${text}`;
}

async function refreshConfig() {
  if (!configDownloadDir || !configTrackers) return;
  try {
    const data = await api("/api/config");
    configDownloadDir.value = data.downloadDir || "";
    configTrackers.value = Array.isArray(data.trackers) ? data.trackers.join("\n") : "";
    configDirLocked = Boolean(data.downloadDirLocked);
    configDownloadDir.disabled = configDirLocked;
    configDownloadDir.title = configDirLocked
      ? "Bloqueado por TORZLINK_DOWNLOAD_DIR"
      : "";
  } catch {
    /* auth gate / offline */
  }
}

function showAuth(needed) {
  if (!authGate || !mainLayout) return;
  authGate.hidden = !needed;
  mainLayout.hidden = needed;
}

function paintCategoryTabs() {
  if (!categoryTabs) return;
  categoryTabs.innerHTML = CATEGORIES.map((c) => {
    const active = c.key === activeCategory ? " is-active" : "";
    return `<button type="button" class="cat-tab${active}" role="tab" aria-selected="${
      c.key === activeCategory ? "true" : "false"
    }" data-category="${escapeHtml(c.key)}">${escapeHtml(c.label)}</button>`;
  }).join("");
}

function searchQueryParams(q) {
  const params = new URLSearchParams({ q });
  const cat = CATEGORIES.find((c) => c.key === activeCategory);
  if (cat?.group) params.set("group", cat.group);
  if (hideDeadEl?.checked) params.set("hideDead", "1");
  const sort = sortFieldEl?.value;
  if (sort) params.set("sort", sort);
  return params;
}

function renderResults(results) {
  if (!results.length) {
    resultsEl.innerHTML = `<li class="empty">· sin resultados</li>`;
    return;
  }
  resultsEl.innerHTML = results
    .map((r) => {
      const ss = sourceStyle(r.source);
      const payload = encodeURIComponent(
        JSON.stringify({
          id: r.infoHash,
          name: r.name,
          magnet: r.magnet,
          source: r.source,
          sizeBytes: r.sizeBytes,
        }),
      );
      const copyPayload = encodeURIComponent(
        JSON.stringify({
          name: r.name,
          magnet: r.magnet,
          infoHash: r.infoHash,
        }),
      );
      return `
      <li class="card card--result">
        <div class="card-title"><span class="pointer">❯</span>${escapeHtml(r.name)}</div>
        <div class="meta">
          <span class="badge src" style="--src:${ss.color}">${escapeHtml(ss.tag)}</span>
          <span>${formatBytes(r.sizeBytes)}</span>
          <span class="seeds">↑${r.seeders}</span>
          <span class="leech">↓${r.leechers}</span>
        </div>
        <div class="actions">
          <button type="button" class="secondary" data-copy="${copyPayload}">Copiar</button>
          <button type="button" data-download="${payload}">Descargar</button>
        </div>
      </li>`;
    })
    .join("");
}

async function runSearch(q) {
  if (!q) return;
  lastQuery = q;
  setStatus("buscando…");
  resultsEl.innerHTML = "";
  try {
    const data = await api(`/api/search?${searchQueryParams(q)}`);
    const errN = data.errors?.length || 0;
    setStatus(
      `${data.results.length} resultados` + (errN ? ` · ${errN} fuente(s) con error` : ""),
    );
    renderResults(data.results || []);
  } catch (err) {
    setStatus(err.message || "error de búsqueda");
  }
}

async function bootAuth() {
  const meta = await fetch("/api/auth").then((r) => r.json()).catch(() => ({ required: false }));
  if (!meta.required) {
    showAuth(false);
    return true;
  }
  if (getToken()) {
    try {
      await api("/api/downloads");
      showAuth(false);
      return true;
    } catch {
      /* need prompt */
    }
  }
  showAuth(true);
  return false;
}

function paintNetSwitch(vpn) {
  if (netSwitch) {
    netSwitch.setAttribute("aria-checked", vpn ? "true" : "false");
    netSwitch.title = vpn
      ? "VPN ON — clic para apagar (red del NAS)"
      : "VPN OFF — clic para encender (Gluetun)";
  }
  if (netSwitchState) {
    netSwitchState.textContent = vpn ? "ON" : "OFF";
    netSwitchState.classList.toggle("is-on", vpn);
    netSwitchState.classList.toggle("is-off", !vpn);
  }
  if (brandModeLabel) {
    brandModeLabel.textContent = vpn ? "vpn" : "lan";
  }
}

function paintNetStatus(status) {
  if (!netStatusEl) return;
  if (status.hint) {
    netStatusEl.hidden = false;
    netStatusEl.textContent = `❯ ${status.hint}`;
    netStatusEl.classList.toggle("ok", Boolean(status.applied));
    return;
  }
  if (!status.applied && status.desired !== status.runtime) {
    netStatusEl.hidden = false;
    netStatusEl.textContent = `❯ preferencia ${status.desired} — runtime actual: ${status.runtime}`;
    netStatusEl.classList.remove("ok");
    return;
  }
  netStatusEl.hidden = true;
  netStatusEl.textContent = "";
}

function paintNetwork(status) {
  const mode = status.desired || status.runtime || "direct";
  currentNetMode = mode;
  paintNetSwitch(mode === "vpn");
  paintNetStatus(status);
}

async function refreshNetwork() {
  try {
    const status = await api("/api/network");
    paintNetwork(status);
  } catch {
    /* auth gate / offline */
  }
}

async function setNetworkMode(mode) {
  if (netSwitch) netSwitch.disabled = true;
  try {
    const status = await api("/api/network", {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
    paintNetwork(status);
  } catch (err) {
    paintNetwork({ desired: currentNetMode, runtime: currentNetMode, applied: true });
    if (netStatusEl) {
      netStatusEl.hidden = false;
      netStatusEl.textContent = `❯ ${err.message || "no se pudo cambiar el modo"}`;
      netStatusEl.classList.remove("ok");
    }
  } finally {
    if (netSwitch) netSwitch.disabled = false;
  }
}

function setLibTab(tab) {
  activeLibTab = tab;
  document.querySelectorAll("[data-lib-tab]").forEach((btn) => {
    const on = btn.dataset.libTab === tab;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll("[data-lib-pane]").forEach((pane) => {
    pane.hidden = pane.dataset.libPane !== tab;
  });
  void refreshLibrary();
}

async function refreshLibrary() {
  if (activeLibTab === "queue") await refreshQueue();
  else if (activeLibTab === "history") await refreshHistory();
  else await refreshSeeds();
}

netSwitch?.addEventListener("click", () => {
  void setNetworkMode(currentNetMode === "vpn" ? "direct" : "vpn");
});

categoryTabs?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-category]");
  if (!btn) return;
  activeCategory = btn.dataset.category || "all";
  paintCategoryTabs();
  if (lastQuery) void runSearch(lastQuery);
});

hideDeadEl?.addEventListener("change", () => {
  if (lastQuery) void runSearch(lastQuery);
});

sortFieldEl?.addEventListener("change", () => {
  if (lastQuery) void runSearch(lastQuery);
});

document.querySelectorAll("[data-lib-tab]").forEach((btn) => {
  btn.addEventListener("click", () => setLibTab(btn.dataset.libTab || "queue"));
});

authForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const rawToken = new FormData(authForm).get("token");
  const t = typeof rawToken === "string" ? rawToken.trim() : "";
  setToken(t);
  try {
    await api("/api/downloads");
    showAuth(false);
    await refreshNetwork();
    await refreshConfig();
    await refreshLibrary();
  } catch (err) {
    alert(err.message || "Token inválido");
  }
});

searchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const rawQ = new FormData(searchForm).get("q");
  const q = typeof rawQ === "string" ? rawQ.trim() : "";
  if (!q) return;
  await runSearch(q);
});

resultsEl.addEventListener("click", async (e) => {
  const copyBtn = e.target.closest("[data-copy]");
  if (copyBtn) {
    try {
      const payload = JSON.parse(decodeURIComponent(copyBtn.dataset.copy || ""));
      copyBtn.disabled = true;
      try {
        await navigator.clipboard.writeText(payload.magnet);
      } catch {
        /* server still saves / notifies */
      }
      const data = await api("/api/copy-magnet", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      copyBtn.textContent = data.savedPath ? "guardado" : "copiado";
      setTimeout(() => {
        copyBtn.textContent = "Copiar";
        copyBtn.disabled = false;
      }, 1600);
    } catch (err) {
      alert(err.message || "No se pudo copiar");
      copyBtn.disabled = false;
    }
    return;
  }

  const btn = e.target.closest("[data-download]");
  if (!btn) return;
  try {
    const payload = JSON.parse(decodeURIComponent(btn.dataset.download || ""));
    btn.disabled = true;
    await api("/api/downloads", { method: "POST", body: JSON.stringify(payload) });
    btn.textContent = "en cola";
    await refreshQueue();
  } catch (err) {
    alert(err.message || "No se pudo añadir");
    btn.disabled = false;
  }
});

magnetForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const rawMagnet = new FormData(magnetForm).get("magnet");
  const input = typeof rawMagnet === "string" ? rawMagnet.trim() : "";
  if (!input) return;
  try {
    await api("/api/downloads", { method: "POST", body: JSON.stringify({ input }) });
    magnetForm.reset();
    setLibTab("queue");
    await refreshQueue();
  } catch (err) {
    alert(err.message || "Magnet inválido");
  }
});

queueEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  try {
    await api(`/api/downloads/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      body: "{}",
    });
    await refreshQueue();
  } catch (err) {
    alert(err.message || "Acción fallida");
  }
});

historyEl?.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-history-action]");
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.historyAction;
  try {
    if (action === "remove") {
      await api(`/api/history/${encodeURIComponent(id)}`, { method: "DELETE" });
    } else if (action === "redownload") {
      await api(`/api/history/${encodeURIComponent(id)}/redownload`, {
        method: "POST",
        body: "{}",
      });
      setLibTab("queue");
    } else if (action === "copy") {
      const payload = JSON.parse(decodeURIComponent(btn.dataset.copy || ""));
      try {
        await navigator.clipboard.writeText(payload.magnet);
      } catch {
        /* server fallback */
      }
      await api("/api/copy-magnet", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      btn.textContent = "copiado";
      setTimeout(() => {
        btn.textContent = "Copiar";
      }, 1200);
      return;
    }
    await refreshHistory();
  } catch (err) {
    alert(err.message || "Acción fallida");
  }
});

seedsEl?.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-seed-action]");
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.seedAction;
  try {
    await api(`/api/seeds/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      body: "{}",
    });
    await refreshSeeds();
  } catch (err) {
    alert(err.message || "Acción fallida");
  }
});

historyClearBtn?.addEventListener("click", async () => {
  if (!confirm("¿Vaciar todo el historial y seeds asociados?")) return;
  try {
    await api("/api/history", { method: "DELETE" });
    await refreshHistory();
    await refreshSeeds();
  } catch (err) {
    alert(err.message || "No se pudo vaciar");
  }
});

async function refreshQueue() {
  try {
    const data = await api("/api/downloads");
    const items = data.items || [];
    if (!items.length) {
      queueEl.innerHTML = `<li class="empty">· cola vacía</li>`;
      return;
    }
    queueEl.innerHTML = items
      .map((it) => {
        const pct = Math.round((it.progress || 0) * 100);
        const pauseLabel = it.status === "paused" ? "Reanudar" : "Pausar";
        const pauseAction = it.status === "paused" ? "resume" : "pause";
        const canPause = it.status === "downloading" || it.status === "paused";
        const eta = formatEta(it.eta);
        let icon = "↓";
        if (it.status === "completed") icon = "✓";
        else if (it.status === "failed") icon = "✗";
        else if (it.status === "paused") icon = "⏸";
        return `
        <li class="card">
          <div class="card-title"><span class="pointer">${icon}</span>${escapeHtml(it.name)}</div>
          <div class="meta">
            <span class="badge ${escapeHtml(it.status)}">${escapeHtml(it.status)}</span>
            <span>${pct}%</span>
            <span>${formatBytes(it.downloadedBytes)} / ${formatBytes(it.totalBytes)}</span>
            <span>${formatSpeed(it.speed)}</span>
            <span>• ${it.peers || 0}</span>
            ${eta ? `<span>ETA ${eta}</span>` : ""}
          </div>
          <div class="bar"><span style="width:${pct}%"></span></div>
          <div class="actions">
            ${
              canPause
                ? `<button type="button" class="secondary" data-action="${pauseAction}" data-id="${escapeHtml(it.id)}">${pauseLabel}</button>`
                : ""
            }
            <button type="button" class="danger" data-action="cancel" data-id="${escapeHtml(it.id)}">Cancelar</button>
          </div>
        </li>`;
      })
      .join("");
  } catch (err) {
    queueEl.innerHTML = `<li class="empty">✗ ${escapeHtml(err.message || "error de cola")}</li>`;
  }
}

async function refreshHistory() {
  if (!historyEl) return;
  try {
    const data = await api("/api/history");
    const items = data.items || [];
    if (!items.length) {
      historyEl.innerHTML = `<li class="empty">· historial vacío</li>`;
      return;
    }
    historyEl.innerHTML = items
      .map((it) => {
        const ss = sourceStyle(it.source);
        const when = it.completedAt ? new Date(it.completedAt).toLocaleString() : "";
        const copyPayload = encodeURIComponent(
          JSON.stringify({
            name: it.name,
            magnet: it.magnet || "",
            infoHash: it.id,
          }),
        );
        return `
        <li class="card">
          <div class="card-title"><span class="pointer">✓</span>${escapeHtml(it.name)}</div>
          <div class="meta">
            <span class="badge src" style="--src:${ss.color}">${escapeHtml(ss.tag)}</span>
            <span>${formatBytes(it.sizeBytes)}</span>
            <span>${escapeHtml(when)}</span>
          </div>
          <div class="actions">
            <button type="button" class="secondary" data-history-action="copy" data-copy="${copyPayload}">Copiar</button>
            <button type="button" data-history-action="redownload" data-id="${escapeHtml(it.id)}">Re-descargar</button>
            <button type="button" class="danger" data-history-action="remove" data-id="${escapeHtml(it.id)}">Quitar</button>
          </div>
        </li>`;
      })
      .join("");
  } catch (err) {
    historyEl.innerHTML = `<li class="empty">✗ ${escapeHtml(err.message || "error de historial")}</li>`;
  }
}

async function refreshSeeds() {
  if (!seedsEl) return;
  try {
    const data = await api("/api/seeds");
    const items = data.items || [];
    if (!items.length) {
      seedsEl.innerHTML = `<li class="empty">· sin seeds activos</li>`;
      return;
    }
    seedsEl.innerHTML = items
      .map((it) => {
        const pauseLabel = it.status === "seeding" ? "Pausar" : "Reanudar";
        const pauseAction = it.status === "seeding" ? "pause" : "resume";
        const canToggle = it.status === "seeding" || it.status === "paused";
        return `
        <li class="card">
          <div class="card-title"><span class="pointer">↑</span>${escapeHtml(it.name)}</div>
          <div class="meta">
            <span class="badge ${escapeHtml(it.status)}">${escapeHtml(it.status)}</span>
            <span>${formatBytes(it.sizeBytes)}</span>
            <span>${formatSpeed(it.uploadSpeed)} ↑</span>
            <span>• ${it.peers || 0}</span>
          </div>
          <div class="actions">
            ${
              canToggle
                ? `<button type="button" class="secondary" data-seed-action="${pauseAction}" data-id="${escapeHtml(it.id)}">${pauseLabel}</button>`
                : ""
            }
          </div>
        </li>`;
      })
      .join("");
  } catch (err) {
    seedsEl.innerHTML = `<li class="empty">✗ ${escapeHtml(err.message || "error de seeds")}</li>`;
  }
}

configForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!configDownloadDir || !configTrackers) return;
  setConfigStatus("guardando…");
  try {
    const body = { trackers: configTrackers.value };
    if (!configDirLocked) body.downloadDir = configDownloadDir.value;
    const data = await api("/api/config", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    configDownloadDir.value = data.downloadDir || "";
    configTrackers.value = Array.isArray(data.trackers) ? data.trackers.join("\n") : "";
    configDirLocked = Boolean(data.downloadDirLocked);
    configDownloadDir.disabled = configDirLocked;
    let msg = "config guardada";
    if (Array.isArray(data.unknownTrackerHosts) && data.unknownTrackerHosts.length) {
      msg += ` · hosts desconocidos: ${data.unknownTrackerHosts.join(", ")}`;
    }
    if (configDirLocked) msg += " · dir fijado por env";
    setConfigStatus(msg);
  } catch (err) {
    setConfigStatus(err.message || "error al guardar");
  }
});

paintCategoryTabs();

const ok = await bootAuth();
if (ok) {
  await refreshNetwork();
  await refreshConfig();
  await refreshLibrary();
  setInterval(() => {
    if (activeLibTab === "queue") void refreshQueue();
    else if (activeLibTab === "seeding") void refreshSeeds();
  }, 1000);
}
