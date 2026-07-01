# torlink web

A pure client-side, no-backend torrent finder. Everything — search, the BitTorrent client, file saving — runs in your browser. There is no server: this directory is a static bundle you can host anywhere that serves static files, including opening `index.html` directly via `file://` — see [Opening via `file://`](#opening-via-file) for exactly what that mode does and doesn't support, verified with real testing rather than assumed.

## Why it's different from the CLI

The `torlnk` CLI (the rest of this repo) does its scraping and downloading in Node, where it can hit any site and speak raw BitTorrent over TCP/UDP. A browser can't do either of those things:

- **Search** only works against sites that send `Access-Control-Allow-Origin` headers (or can be reached through a CORS proxy). Most torrent sites don't, and some are behind Cloudflare/DDoS-Guard bot challenges that block even proxied requests.
- **Downloading** only works over WebRTC ([WebTorrent](https://webtorrent.io)'s browser transport), which means a torrent only downloads if it has at least one peer also running a WebRTC-capable client. Most torrents on the open web are seeded by ordinary TCP/UDP clients and simply won't have any browser-reachable peers — even a healthy download can sit at 0 peers indefinitely. **"Copy magnet" and open it in a real torrent client is the reliable path**; in-browser download is best-effort.
- Relatedly: `udp://` trackers (what the CLI and every normal torrent client use) are unreachable from a browser — no raw socket access. Every magnet the app builds or receives gets `wss://` (WebSocket) trackers injected via WebTorrent's `announce` option (`web/js/magnet.js`), since those are the only kind a browser can actually use. Verified live against [WebTorrent's own seeded demo torrent](https://webtorrent.io/free-torrents): tracker connects, peer found, real download speed. A torrent stuck at 0 peers with a working tracker connection means the swarm itself has no WebRTC-reachable peers right now, not that something's broken.
- Finding peers isn't the whole story either: a peer can complete the WebRTC handshake and declare metadata support, then just... never actually send the metadata. Verified live (real-world torrent, 2 connected peers, `ut_metadata` extension actively "fetching" with zero errors, still incomplete after 15+ seconds) — this isn't a choking issue (BEP 9 extended messages are explicitly exempt from choke state, confirmed in the vendored source), it's peer unreliability: many WebRTC-reachable "peers" found via public trackers are other half-connected browser tabs, not real seeders. The app detects this (`web/js/download.js`'s `STALL_TIMEOUT_MS`, 25s) and flags the download as "stalled" with a one-click "Copy magnet" fallback once peers are connected but no data has moved.
- **Is there a way around the UDP wall — something like a CORS proxy but for BitTorrent peers?** No, not in any lightweight sense. Researched this directly:
  - The [Direct Sockets API](https://github.com/WICG/direct-sockets/blob/main/docs/explainer.md) (the only browser proposal for raw TCP/UDP) is explicitly restricted to installed [Isolated Web Apps](https://github.com/WICG/isolated-web-apps) — not visitable websites, so it doesn't apply here regardless of browser support.
  - The pattern that *does* bridge regular BitTorrent swarms to something a browser can use ([webtor.io](https://webtor.io), built on [torrent-http-proxy](https://github.com/webtor-io/torrent-http-proxy)) is a full Kubernetes-based backend — per-torrent job orchestration, Redis, a dedicated seeder process per download — not a stateless request relay like a CORS proxy.
  - No already-running free public instance of that bridge exists either: webtor.io's actual API product is distributed exclusively through a paid/signup [RapidAPI](https://rapidapi.com) gateway (confirmed via their own `rapidapi-gateway` repo), and their JS SDK is now archived in favor of "self-host it yourself." Even if a generous free tier existed, an API-key-gated service can't be used from a pure static page anyway — a key embedded in client-side JS is visible to anyone who views source and would get extracted and drained. That class of service structurally requires a backend to hold the secret, which is exactly what this architecture avoids.
  - Bottom line: bridging UDP peers costs real, sustained bandwidth and compute per torrent, unlike relaying one HTTP request, so there's no free-tier-shaped version of this the way `allorigins.win` exists for CORS. The realistic options are self-hosting the bridge, paying for a keyed API behind your own thin backend, or accepting the current best-effort model — WebRTC peers when they exist, stall-detection + "Copy magnet" fallback when they don't.
  - **There is one genuinely free, zero-infrastructure option: bridge it yourself, locally.** `webtorrent` npm v2.3+ (which this repo's own `torlnk` CLI already depends on) has native hybrid TCP/UDP/DHT *and* WebRTC support built in — no more `wrtc`/`webtorrent-hybrid` pain, verified by walking its dependency tree: `webtorrent` → `@thaunknown/simple-peer` → `webrtc-polyfill` → [`node-datachannel`](https://github.com/murat-dogan/node-datachannel) (prebuilt binaries for Windows x86/x64, macOS Intel/ARM, Linux x64/armv7/arm64, actively maintained). So `npm install -g webtorrent-cli` gives any machine a client that's simultaneously a real swarm peer *and* WebRTC-reachable. It doesn't work automatically, though — a plain `webtorrent download <magnet>` only announces to whatever trackers are already in that magnet (almost always `udp://`, invisible to a browser) plus DHT (also UDP-only, also invisible to a browser). To actually become discoverable to torlink-web, add one of the same trackers it listens on explicitly: `webtorrent download "<magnet>" -a wss://tracker.openwebtorrent.com`. Confirmed this additively merges with the magnet's existing trackers rather than replacing them (same underlying `Torrent` class we already verified this behavior on in our own code). No server, no third party — just your own machine acting as its own bridge for a torrent you're already downloading anyway.

This is a deliberate, accepted tradeoff for running with zero infrastructure — see the project conversation that led here if you want the full reasoning.

## Checking peers before downloading

Each search result has a "👀 Check peers" button that answers the question above *before* you commit to a download: does this specific torrent currently have any WebRTC-reachable peers? It works by combining two signals (`web/js/peercheck.js`) — a tracker **scrape** (a lightweight query that asks "how many peers do you know about for this info hash" without joining the swarm) and the live peer count from a normal `announce` (which happens automatically the moment a torrent is added, no extra call needed). Since it only ever talks to our `wss://` trackers (the WebSocket-only ones from `magnet.js`), and only WebRTC-capable clients can reach a WebSocket tracker in the first place, a nonzero result specifically means "there's a browser-reachable peer," not just "there's a peer somewhere."

**Why both signals, not just scrape:** tested this against `ngosang/trackerslist` — the actively-maintained, community-standard tracker list used across the torrent ecosystem — and its *entire* public WebSocket-tracker list has exactly one entry (`tracker.btorrent.xyz`). That matches what was found empirically: only that one tracker reliably answers `scrape` at all (the other two configured trackers never respond to it, waiting longer doesn't help), while all three *do* answer plain `announce`. So scrape alone was silently blind to two-thirds of the trackers being checked — the fix uses whichever signal reports more peers, not just scrape.

**A bug caught in testing, worth calling out:** the first version treated a fast *zero* response (scrape from `tracker.btorrent.xyz` typically answers in under a second, usually with 0) as a reason to start an early-exit countdown — which cut the check off before the other two trackers' slower `announce`-based WebRTC handshake had a real chance to complete, i.e. exactly backwards for a feature meant to find peers. Fixed: only a *positive* signal triggers the early-exit countdown (resolves ~1.5s after finding real peers); a negative signal from one tracker no longer cuts off the others, so a "0 peers" result now waits close to the full 12s timeout rather than returning early on a fast false negative.

**Caveat worth setting expectations on:** even a positive result is a snapshot, not a guarantee — retesting the exact same magnet minutes apart produced different peer counts in practice (WebRTC peers in the wild are mostly other browser tabs that come and go, not stable seed infrastructure). Treat "found peers" as "worth trying," not "will definitely work" — this is the same volatility documented above for downloads generally.

This reuses the tracker-client code already bundled inside `webtorrent.min.js` (no extra library, no build step) via a torrent's `discovery.tracker`, which only exists on a real `Torrent` instance — so the probe briefly calls `client.add()` on its own dedicated, throwaway `WebTorrent` client, kept fully separate from the main downloader so probes never leak into the Downloads panel, and destroys the torrent once it resolves or after the timeout.

## Adding your own trackers

Settings (⚙) has an "Extra trackers" field, mirroring the CLI's own `t`-key tracker feature (`src/config/trackers.ts`) — same parsing/validation ported directly (comma/whitespace-split, deduped, scheme-restricted to `udp`/`http(s)`/`ws(s)`) so the two stay behaviorally consistent. Whatever you add is merged into every download's announce list alongside the three built-in `wss://` discovery trackers (additive, not a replacement — same as the CLI's own behavior).

The practical use case here is different from the CLI's, though: in a browser, only `wss://` entries do anything (see the UDP-wall discussion above) — `udp://`/`http(s)://`/`ws://` are accepted for parity but won't find you any peers. Point this at your own bridge (e.g. a `webtorrent-cli`/qBittorrent instance you're running locally with `-a wss://...`, see above) to make it directly discoverable to this page specifically, on top of the shared public trackers everyone else also uses.

## Source coverage (verified)

| Source | Group | Access |
|---|---|---|
| YTS (`movies-api.accel.li`) | Movies | Direct — native CORS |
| PirateBay (`apibay.org`) | Movies, TV | Via CORS proxy |
| SolidTorrents (now `bitsearch.eu`) | TV | Direct — native CORS |
| EZTV (`eztvx.to`) | TV | Direct — native CORS, browse-only (the API has no search, so the latest 100 are fetched and filtered client-side) |
| Nyaa | Anime | Via CORS proxy |
| SubsPlease | Anime | Via CORS proxy |
| FitGirl | Games | Via CORS proxy (WordPress RSS feed) |

Not included: 1337x — behind a Cloudflare JS challenge that blocks even proxied requests, not just a missing-CORS-header problem. A CORS proxy relays a request; it doesn't solve a bot challenge, so this one stays out regardless of which proxy is configured.

## The CORS proxy

PirateBay, Nyaa, SubsPlease, and FitGirl have no CORS headers, so their requests go through a configurable, ordered list of proxies (`api.allorigins.win` by default) — each source tries them in order and falls through to the next on failure. **Free public proxies have no uptime guarantee**; nearly 20 candidates were tested (including the full list from [this gist](https://gist.github.com/jimmywarting/ac1be6ea0297c16c477e17f8fbe51347)) and almost all turned out dead, blocklisted for torrent domains, or just docs pages with no live endpoint behind them — `allorigins.win` was the only one that reliably worked anonymously. Open Settings (⚙) to add your own as a fallback (one URL prefix per line, tried top to bottom) if search for those sources stops working.

One paid-tier option worth knowing about if reliability matters to you: [Corsfix](https://corsfix.com) is genuinely alive and works against all four sources above, but its free tier only serves `localhost`/private-IP origins without an account — for a real deployed domain it needs you to sign up and register the site (`https://proxy.corsfix.com/?<url>`, prefix: `https://proxy.corsfix.com/?`). Not a default for that reason, but a solid add-your-own option.

YTS/SolidTorrents/EZTV bypass the proxy list entirely.

## Streaming (Play)

Once a torrent's metadata resolves, video files inside it get a "▶ Play" button in the Downloads panel — single file shows one button, multi-file torrents (season packs) list every video file with its own Play button. Playback pulls pieces near the current position first rather than waiting for the whole torrent.

There are two playback paths, chosen automatically per file:

- **Server path** (`.mp4`, `.mkv`, `.webm`, `.mov`, `.m4v`, `.avi`, proper seeking) — used whenever a Service Worker is available, i.e. the page is served over `https://` or `http://localhost`. Registered lazily on first Play click, not on page load.
- **`file://` fallback** (`.mp4`/`.webm` only, no seeking) — used when Service Workers aren't available, which includes opening `index.html` directly from disk. Streams by feeding downloaded pieces straight into a `MediaSource` buffer in order. `.mkv`/`.avi`/`.mov` files never get a Play button in this mode — browsers can't decode those containers via `MediaSource` regardless of how the bytes arrive, so there's no fallback path for them.

Either way:

- Closing the player stops playback but **not** the underlying download — the torrent keeps fetching/seeding in the Downloads panel regardless.
- This inherits the same WebRTC peer-availability limits as downloading (see above): playback only starts if the torrent actually has browser-reachable peers.

## Opening via `file://`

This used to be broken, silently. All the app's JS was written as ES modules (`<script type="module">`), and Chrome flatly refuses to load ES modules — static `import`, `<script type="module">`, and even dynamic `import()` — under the `file://` protocol at all, treating every local file as a distinct `null` origin and rejecting the request outright. Confirmed directly with real headless Chrome testing (not assumed): `app.js` never executed, meaning *nothing* worked — not "streaming doesn't work," the entire app silently failed to load.

Fixed by converting every file in `web/js/` off `import`/`export` to plain classic `<script>` tags, each wrapped in an IIFE and attaching only its intended exports to a shared `window.Torlink` namespace (classic scripts share one global scope, so without the IIFE wrapper, files that happen to reuse names like `search` or `API` internally would collide). The vendored `webtorrent.min.js` had exactly one ES-module construct in the whole 218KB bundle (`export{Kt as default}` at the very end) — patched to `window.WebTorrent=Kt` so it loads as a classic script too, since it ships with no alternative non-ESM build.

With that fixed, tested what actually works via `file://` using a self-driving headless-Chrome harness (fills the search box, submits, waits, inspects the real rendered DOM) rather than just checking for console errors:

- **Search works** for the direct-CORS sources (YTS, SolidTorrents, EZTV) — real results render.
- **CORS-proxied sources (Nyaa, SubsPlease, FitGirl, PirateBay) do not work via `file://`** — `api.allorigins.win` doesn't grant `Origin: null` (what `file://` sends) the same access it grants a real origin like `http://localhost`. This is the proxy's own policy, not something fixable in this app's code.
- **Magnet-paste and download-adding work** — a torrent gets added and tracked correctly.
- **IndexedDB doesn't work under `file://`** — a request via `indexedDB.open()` just hangs forever (fires neither `onsuccess` nor `onerror`), confirmed directly. WebTorrent's default browser chunk store is IndexedDB-backed, which would have made real download data silently stall. Fixed with a small in-memory chunk store (`web/js/download.js`'s `MemoryChunkStore`, matching the standard `abstract-chunk-store` interface) swapped in automatically only when `location.protocol === "file:"` — real `http(s)://` deployments keep the better persistent default.
- **An intermittent, unexplained `SecurityError`** ("certain files are unsafe for access...") shows up in some `file://` test runs. Investigated significantly — ruled out fetch concurrency, chunk storage, and `localStorage`/`sessionStorage` as the cause via isolated tests — without finding a definitive root cause. Documented here rather than silently dropped: in every test where it appeared, it did **not** block observable functionality (search still rendered real results, downloads still started correctly). Treat it as a known, apparently-benign console warning until someone traces it further.
- Streaming's Service-Worker path still requires `https://`/`localhost` (Service Workers are unavailable under `file://` by spec, unrelated to any of the above) — the `MediaSource` fallback path is what actually plays video under `file://`, per the Streaming section above.

## Saving files

Downloaded files save via the File System Access API (lets you pick where to save, Chrome/Edge) or fall back to a plain browser download (Firefox/Safari — goes to your Downloads folder, no folder structure). There's no background downloading: the tab has to stay open.

## Running it locally

No build step. Any static file server works:

```sh
python3 -m http.server 4173 --directory web
# or: npx serve web
```

Then open `http://localhost:4173`.

## Deploying

This is a self-contained static directory (the WebTorrent library is vendored in `vendor/`, the streaming service worker in `sw.min.js` at the root — nothing is fetched at build time) — copy `web/` to any static host (a VPS, object storage with static hosting, etc.) and it works as-is. No environment variables, no server process, no database. Keep `sw.min.js` at the site root when deploying — it has to be served from there for its scope to cover the whole app.

## Staying in sync with the CLI

This directory is a separate implementation, not a codegen output of the CLI — there's no automated way to pull in upstream changes, so it drifts unless someone deliberately checks. A lightweight process that's worked so far: periodically diff against whatever commit this was last synced at —

```sh
git log <last-synced-sha>..origin/main --oneline
```

— and sort what comes back into two buckets:

- **TUI-only** (Ink component changes, keybinding/footer/layout tweaks, terminal rendering fixes) — doesn't apply here at all, the two UIs don't share presentation code or interaction models.
- **Behavioral/protocol/config changes** (new sources, tracker/announce logic, download semantics, anything under `src/config/`, `src/download/`, `src/sources/`) — worth porting. These are the ones actually worth checking for, since they represent a capability gap between the two versions rather than a cosmetic one.

Concretely, that's meant checking `src/download/`, `src/config/`, and `src/sources/` diffs closely and skimming past pure `src/ui/` diffs unless they touch something the web app also has a UI for (e.g. a new keybinding for a feature the web app already exposes via a button is worth noting even if the keybinding itself isn't). The most recent sync (four commits: three TUI-only, one real — the CLI's new user-supplied-tracker feature) is ported above as "Adding your own trackers." Last synced through commit `f3880f1`.

## What's explicitly out of scope

No routing, no multi-tab sync, no batch actions, no light theme. Matches the CLI's own "lightweight and clean" philosophy — see the root [README](../README.md) for the project this is built on top of.
