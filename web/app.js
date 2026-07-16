const TOKEN_KEY = "torzlinkServeToken";

const resultsEl = document.getElementById("results");
const queueEl = document.getElementById("queue");
const searchStatus = document.getElementById("search-status");
const searchForm = document.getElementById("search-form");
const magnetForm = document.getElementById("magnet-form");
const authGate = document.getElementById("auth-gate");
const authForm = document.getElementById("auth-form");
const mainLayout = document.getElementById("main");

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

async function api(path, options) {
  const headers = { "content-type": "application/json", ...(options?.headers || {}) };
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
  searchStatus.textContent = text;
}

function showAuth(needed) {
  if (!authGate || !mainLayout) return;
  authGate.hidden = !needed;
  mainLayout.hidden = needed;
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

authForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const t = new FormData(authForm).get("token")?.toString().trim() || "";
  setToken(t);
  try {
    await api("/api/downloads");
    showAuth(false);
    await refreshQueue();
  } catch (err) {
    alert(err.message || "Token inválido");
  }
});

searchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = new FormData(searchForm).get("q")?.toString().trim() || "";
  if (!q) return;
  setStatus("Buscando…");
  resultsEl.innerHTML = "";
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
    const errN = data.errors?.length || 0;
    setStatus(
      `${data.results.length} resultados` + (errN ? ` (${errN} fuentes con error)` : ""),
    );
    if (!data.results.length) {
      resultsEl.innerHTML = `<p class="empty">Sin resultados.</p>`;
      return;
    }
    resultsEl.innerHTML = data.results
      .map((r) => {
        const payload = encodeURIComponent(
          JSON.stringify({
            id: r.infoHash,
            name: r.name,
            magnet: r.magnet,
            source: r.source,
            sizeBytes: r.sizeBytes,
          }),
        );
        return `
      <article class="card" role="listitem">
        <div class="card-title">${escapeHtml(r.name)}</div>
        <div class="meta">
          <span>${escapeHtml(r.source)}</span>
          <span>${formatBytes(r.sizeBytes)}</span>
          <span>↑${r.seeders} ↓${r.leechers}</span>
        </div>
        <div class="actions">
          <button type="button" data-download="${payload}">Descargar</button>
        </div>
      </article>`;
      })
      .join("");
  } catch (err) {
    setStatus(err.message || "Error de búsqueda");
  }
});

resultsEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-download]");
  if (!btn) return;
  try {
    const payload = JSON.parse(decodeURIComponent(btn.getAttribute("data-download") || ""));
    btn.disabled = true;
    await api("/api/downloads", { method: "POST", body: JSON.stringify(payload) });
    btn.textContent = "En cola";
    await refreshQueue();
  } catch (err) {
    alert(err.message || "No se pudo añadir");
    btn.disabled = false;
  }
});

magnetForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = new FormData(magnetForm).get("magnet")?.toString().trim() || "";
  if (!input) return;
  try {
    await api("/api/downloads", { method: "POST", body: JSON.stringify({ input }) });
    magnetForm.reset();
    await refreshQueue();
  } catch (err) {
    alert(err.message || "Magnet inválido");
  }
});

queueEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const id = btn.getAttribute("data-id");
  const action = btn.getAttribute("data-action");
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

async function refreshQueue() {
  try {
    const data = await api("/api/downloads");
    const items = data.items || [];
    if (!items.length) {
      queueEl.innerHTML = `<p class="empty">La cola está vacía.</p>`;
      return;
    }
    queueEl.innerHTML = items
      .map((it) => {
        const pct = Math.round((it.progress || 0) * 100);
        const pauseLabel = it.status === "paused" ? "Reanudar" : "Pausar";
        const pauseAction = it.status === "paused" ? "resume" : "pause";
        const canPause = it.status === "downloading" || it.status === "paused";
        return `
        <article class="card" role="listitem">
          <div class="card-title">${escapeHtml(it.name)}</div>
          <div class="meta">
            <span class="badge ${escapeHtml(it.status)}">${escapeHtml(it.status)}</span>
            <span>${pct}%</span>
            <span>${formatBytes(it.downloadedBytes)} / ${formatBytes(it.totalBytes)}</span>
            <span>${formatSpeed(it.speed)}</span>
            <span>${it.peers || 0} peers</span>
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
        </article>`;
      })
      .join("");
  } catch (err) {
    queueEl.innerHTML = `<p class="empty">${escapeHtml(err.message || "Error al cargar cola")}</p>`;
  }
}

(async () => {
  const ok = await bootAuth();
  if (ok) {
    await refreshQueue();
    setInterval(refreshQueue, 1000);
  }
})();
