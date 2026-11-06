import WebTorrent, { type Torrent } from "webtorrent";
import {
  clearBindAddress,
  interfaceNames,
  setBindAddress,
  utpBindable,
  type InterfaceTable,
} from "../util/bind";
import {
  networkFromEnv,
  startInterfaceGuard,
  type NetworkOptions,
  type NetworkStatus,
} from "./network";

export interface TorrentProgress {
  progress: number;
  downloaded: number;
  total: number;
  speed: number;
  uploadSpeed: number;
  uploaded: number;
  peers: number;
  timeRemaining: number;
  name: string;
}

export interface TorrentMeta {
  name: string;
  total: number;
  files: number;
  // The .torrent metadata (piece hashes), available once metadata arrives. We
  // persist it so a later re-seed can verify the on-disk file without having to
  // re-fetch metadata from the swarm (which a bare magnet would require).
  torrentFile?: Uint8Array;
}

export interface AddHandlers {
  onMetadata?: (meta: TorrentMeta) => void;
  // webtorrent has checked any pieces already on disk against their hashes and
  // the torrent is ready to trade. On a large seed that check runs for minutes.
  onReady?: () => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}

export interface EngineOptions extends NetworkOptions {
  onNetwork?: (status: NetworkStatus) => void;
  // Test seams: where the interface guard reads the interface table, and how
  // often it looks.
  interfaces?: () => InterfaceTable;
  guardIntervalMs?: number;
}

// A runtime change to the network options; null clears a field.
export interface NetworkPatch {
  interface?: string | null;
  peerPort?: number | null;
  dhtPort?: number | null;
}

export type ReconfigureResult = { ok: true; status: NetworkStatus } | { ok: false; error: string };

// A magnet URI, an info hash, or a path to a .torrent file; a thunk is
// re-resolved every time the torrent is attached, so a .torrent stored after
// the first add wins on a re-attach.
export type TorrentSource = string | (() => string);

interface Registration {
  source: TorrentSource;
  dir: string;
  handlers: AddHandlers;
  announce?: string[];
}

// How long a torn-down client gets to release its sockets before the next one
// is built on the same fixed ports.
const TEARDOWN_WAIT_MS = 3000;

// How long an interface has to stay up after a drop before everything is
// re-attached. Re-attaching re-verifies every seed on disk, so a link that
// bounces for a few seconds must not re-hash a seedbox each time.
export const RESUME_SETTLE_MS = 3000;

export function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function applyNetworkPatch(current: NetworkOptions, patch: NetworkPatch): NetworkOptions {
  const next: NetworkOptions = { ...current };
  if (patch.interface !== undefined) {
    if (patch.interface === null) delete next.interface;
    else next.interface = patch.interface;
  }
  if (patch.peerPort !== undefined) {
    if (patch.peerPort === null) delete next.peerPort;
    else next.peerPort = patch.peerPort;
  }
  if (patch.dhtPort !== undefined) {
    if (patch.dhtPort === null) delete next.dhtPort;
    else next.dhtPort = patch.dhtPort;
  }
  return next;
}

export class TorrentEngine {
  private client: WebTorrent | null = null;
  private torrents = new Map<string, Torrent>();
  // Everything add()ed and not yet remove()d, live torrent or not. While the
  // bound interface is down nothing is attached; when it is back, all of this
  // is, with the handlers it was added with.
  private registry = new Map<string, Registration>();
  private net: NetworkOptions;
  private readonly onNetwork: ((status: NetworkStatus) => void) | undefined;
  private readonly interfaces: (() => InterfaceTable) | undefined;
  private readonly guardIntervalMs: number | undefined;
  // False only while a configured interface is down.
  private online = true;
  private address: string | null = null;
  private known: string[] | undefined;
  private stopGuard: (() => void) | null = null;
  // Settles once every client torn down so far has released its sockets.
  private teardown: Promise<void> = Promise.resolve();
  private pendingTeardowns = 0;
  private rebuilding = false;
  private generation = 0;
  // True from a drop until the rebuild that follows it has landed.
  private wasDown = false;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  // The last error the client itself raised (a listen that failed, uTP that
  // would not start), cleared on the next rebuild.
  private lastError: string | null = null;

  constructor(opts: EngineOptions = {}) {
    const { onNetwork, interfaces, guardIntervalMs, ...net } = opts;
    this.onNetwork = onNetwork;
    this.interfaces = interfaces;
    this.guardIntervalMs = guardIntervalMs;
    this.net = applyNetworkPatch(networkFromEnv(), net);
    this.applyNetwork();
  }

  private applyNetwork(): void {
    this.stopGuard?.();
    this.stopGuard = null;
    this.clearResume();
    this.wasDown = false;
    this.known = undefined;
    const spec = this.net.interface;
    if (!spec) {
      clearBindAddress();
      this.address = null;
      this.online = true;
      return;
    }
    // Closed until the guard's first check (synchronous, below) says otherwise.
    this.online = false;
    setBindAddress(null);
    this.stopGuard = startInterfaceGuard(spec, (address, table) => this.onInterface(address, table), {
      ...(this.guardIntervalMs !== undefined ? { intervalMs: this.guardIntervalMs } : {}),
      ...(this.interfaces ? { table: this.interfaces } : {}),
    });
  }

  private onInterface(address: string | null, table: InterfaceTable): void {
    if (address === null) {
      this.clearResume();
      this.wasDown = true;
      this.online = false;
      this.address = null;
      this.known = interfaceNames(table);
      setBindAddress(null);
      this.report();
      this.teardownClient();
      return;
    }
    this.online = true;
    this.address = address;
    this.known = undefined;
    setBindAddress(address);
    this.report();
    if (!this.wasDown) {
      this.rebuild();
      return;
    }
    // Back after a drop: let it settle first. Anything added meanwhile waits
    // with the rest.
    this.rebuilding = true;
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      this.rebuild();
    }, RESUME_SETTLE_MS);
    this.resumeTimer.unref();
  }

  private clearResume(): void {
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
  }

  private report(): void {
    this.onNetwork?.(this.networkStatus());
  }

  // Drop the live client and every torrent on it; the registry stays. The
  // async half waits (bounded) for webtorrent to let go of the ports, so a
  // rebuild on a fixed --peer-port does not race its own predecessor.
  private teardownClient(): void {
    const client = this.client;
    this.client = null;
    for (const t of this.torrents.values()) {
      try {
        t.destroy();
      } catch {}
    }
    this.torrents.clear();
    if (!client) return;
    this.pendingTeardowns++;
    const released = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, TEARDOWN_WAIT_MS);
      timer.unref();
      try {
        client.destroy(() => {
          clearTimeout(timer);
          resolve();
        });
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
    this.teardown = Promise.all([this.teardown, released.then(() => void this.pendingTeardowns--)]).then(
      () => {},
    );
  }

  // Re-attach every registration on a fresh client: right away when nothing is
  // still letting go of its sockets, otherwise once the last teardown lands.
  // A newer rebuild (or destroy) supersedes one still waiting.
  private rebuild(): void {
    if (this.pendingTeardowns === 0) {
      this.rebuilding = false;
      this.attachAll();
      return;
    }
    const gen = ++this.generation;
    this.rebuilding = true;
    void this.teardown.then(() => {
      if (gen !== this.generation) return;
      this.rebuilding = false;
      this.attachAll();
    });
  }

  private attachAll(): void {
    if (!this.online) return;
    this.wasDown = false;
    this.lastError = null;
    for (const [id, reg] of this.registry) this.attach(id, reg);
  }

  private ensureClient(): WebTorrent {
    if (!this.client) {
      // On macOS, mDNSResponder occupies UDP port 5350 — the NAT-PMP
      // client port. Binding it fails asynchronously with EADDRINUSE,
      // and since the PMP client is a raw EventEmitter with no error
      // listener, the error surfaces as an uncaughtException that kills
      // the app the moment a download starts. NAT-PMP can never succeed
      // on macOS because the port is permanently taken, so disable it
      // and let UPnP handle NAT traversal instead.
      //
      // TORLINK_NO_UTP turns uTP off. It stays on by default, the way every
      // major client ships it. Up to webtorrent 2.8.5, lib/torrent.js dialed
      // every outgoing uTP peer through the module-level `UTP.connect`, which
      // bound a fresh UDP socket (plus a 20 ms utp-native timer) per peer, and
      // a peer destroyed while still in the dial queue was dialed anyway with
      // nothing left to close it. Sockets then grew with peer churn until the
      // port pool or buffer space ran out (WSAENOBUFS, #185), or a 10-day
      // daemon sat on ~1000 dead sockets with no torrents at all (#205).
      // webtorrent 3 (webtorrent/webtorrent#3019) dials over the one listening
      // uTP socket instead, which is why the dependency is on 3.x. The opt-out
      // stays for anyone who wants TCP-only peers.
      //
      // Bound to an interface (#164), anything that would talk through another
      // one stays off: LSD is LAN multicast; UPnP and NAT-PMP map ports on
      // whatever gateway the default route has, and would fight the mapping
      // the interface's owner keeps alive; WebRTC gathers ICE candidates from
      // every interface in native code the bind shim cannot reach. The uTP
      // socket is bound natively as well, and when that patch is unavailable
      // uTP stays off rather than open on every interface.
      const bound = this.net.interface !== undefined;
      // webtorrent 3 opens every outgoing peer with an encrypted handshake by
      // default, which plaintext-only peers (torlink 1.10 among them) refuse.
      // 1.10 never encrypted, so neither does this.
      const opts = {
        secure: 0 as const,
        ...(this.net.peerPort ? { torrentPort: this.net.peerPort } : {}),
        ...(this.net.dhtPort ? { dhtPort: this.net.dhtPort } : {}),
        ...(bound
          ? {
              lsd: false,
              natUpnp: false,
              natPmp: false,
              tracker: { wrtc: false },
              ...(utpBindable() ? {} : { utp: false }),
            }
          : {}),
        ...(process.env.TORLINK_NO_UTP ? { utp: false } : {}),
        ...(process.platform === "darwin" ? { natPmp: false } : {}),
      };
      const client = new WebTorrent(opts);
      // webtorrent raises this for a listen that failed (the fixed port is
      // taken) or uTP that would not start. The fatal kind has destroyed the
      // client under its torrents, so drop it here too: the next add, or a
      // POST /network with a free port, then builds a fresh one.
      client.on("error", (err: unknown) => {
        if (this.client !== client) return;
        this.lastError = message(err);
        if (client.destroyed) {
          this.client = null;
          this.torrents.clear();
        }
        this.report();
      });
      client.once("listening", () => {
        if (this.client === client) this.report();
      });
      this.client = client;
    }
    return this.client;
  }

  // `source` is a magnet URI, an infoHash, or a path to a .torrent file (or a
  // thunk returning one). Seeding an existing file passes the stored .torrent
  // path so webtorrent can verify it locally instead of re-fetching metadata
  // from the swarm. `announce` supplements whatever trackers are already in
  // the source URI; webtorrent dedupes internally.
  //
  // While the bound interface is down, or a rebuild is in flight, this only
  // records the torrent; it is attached when the client is back.
  add(
    id: string,
    source: TorrentSource,
    dir: string,
    handlers: AddHandlers,
    announce?: string[],
  ): void {
    const reg: Registration = {
      source,
      dir,
      handlers,
      ...(announce && announce.length > 0 ? { announce } : {}),
    };
    this.registry.set(id, reg);
    if (!this.online || this.rebuilding) return;
    // A client that will not construct throws here, on the caller's stack,
    // as it always has; the queue fails that one item and moves on.
    try {
      this.ensureClient();
    } catch (e) {
      this.registry.delete(id);
      throw e;
    }
    this.attach(id, reg);
  }

  private attach(id: string, reg: Registration): void {
    const existing = this.torrents.get(id);
    if (existing) {
      this.torrents.delete(id);
      try {
        existing.destroy();
      } catch {}
    }

    let torrent: Torrent;
    try {
      // From a rebuild this runs on the guard's timer, so a client that will
      // not construct is an error on this torrent, never an uncaught exception.
      const client = this.ensureClient();
      const source = typeof reg.source === "function" ? reg.source() : reg.source;
      const opts = reg.announce ? { path: reg.dir, announce: reg.announce } : { path: reg.dir };
      torrent = client.add(source, opts);
    } catch (e) {
      this.registry.delete(id);
      reg.handlers.onError?.(message(e));
      return;
    }
    this.torrents.set(id, torrent);

    const handlers = reg.handlers;
    torrent.on("metadata", () => {
      handlers.onMetadata?.({
        name: torrent.name,
        total: torrent.length,
        files: torrent.files?.length ?? 0,
        torrentFile: torrent.torrentFile,
      });
    });
    torrent.on("ready", () => {
      handlers.onReady?.();
    });
    torrent.on("done", () => {
      // A finished torrent is a complete, verified torrent: keep it alive so it
      // can seed. The queue owns its lifetime from here (remove/destroy).
      handlers.onDone?.();
    });
    torrent.on("error", (err: unknown) => {
      handlers.onError?.(message(err));
      // The queue marks it failed or missing and re-adds on retry; a reconnect
      // must not quietly bring it back.
      if (this.registry.get(id) === reg) this.registry.delete(id);
      if (this.torrents.get(id) === torrent) this.torrents.delete(id);
      try {
        torrent.destroy();
      } catch {}
    });
  }

  // The TCP port the client accepts incoming peers on (diagnostics / tests).
  listenPort(): number | null {
    return this.client?.torrentPort ?? null;
  }

  networkStatus(): NetworkStatus {
    const client = this.client;
    let incoming = 0;
    for (const t of this.torrents.values()) {
      try {
        for (const w of t.wires ?? []) if (typeof w.type === "string" && w.type.includes("Incoming")) incoming++;
      } catch {}
    }
    return {
      interface: this.net.interface ?? null,
      address: this.address,
      online: this.online,
      peerPort: client?.listening ? client.torrentPort : null,
      incoming,
      ...(this.known ? { known: this.known } : {}),
      ...(this.lastError !== null ? { error: this.lastError } : {}),
    };
  }

  // Change interface or ports in place: the live client is torn down and
  // every registered torrent comes back on a new one.
  reconfigure(patch: NetworkPatch): ReconfigureResult {
    const next = applyNetworkPatch(this.net, patch);
    if (next.peerPort !== undefined && next.peerPort === next.dhtPort) {
      return { ok: false, error: "dhtPort must differ from peerPort" };
    }
    this.net = next;
    this.teardownClient();
    // With an interface, the guard's first check triggers the rebuild (or
    // keeps everything down); without one nothing else will.
    this.applyNetwork();
    if (!this.net.interface) this.rebuild();
    return { ok: true, status: this.networkStatus() };
  }

  // A torrent's file paths relative to its download dir, top-level folder
  // included; empty before metadata arrives or once the torrent is gone.
  filePaths(id: string): string[] {
    return (this.torrents.get(id)?.files ?? []).map((file) => file.path);
  }

  stats(id: string): TorrentProgress | null {
    const t = this.torrents.get(id);
    if (!t) return null;

    let progress = 0;
    let downloaded = 0;
    let total = 0;
    let speed = 0;
    let uploadSpeed = 0;
    let uploaded = 0;
    let peers = 0;
    let timeRemaining = Infinity;
    let name = "";

    try {
      progress = t.progress || 0;
      downloaded = t.downloaded || 0;
      total = t.length || 0;
      speed = t.downloadSpeed || 0;
      uploadSpeed = t.uploadSpeed || 0;
      uploaded = t.uploaded || 0;
      peers = t.numPeers || 0;
      timeRemaining = typeof t.timeRemaining === "number" && !isNaN(t.timeRemaining) ? t.timeRemaining : Infinity;
      name = t.name || "";
    } catch {
      // Every stat is read inside this try on purpose: webtorrent getters can
      // throw before metadata parses and on a torrent in an error state, and
      // stats() runs from the poll interval, where an escaping throw is an
      // uncaught exception. Partial numbers beat a dead poller.
    }

    return {
      progress,
      downloaded,
      total,
      speed,
      uploadSpeed,
      uploaded,
      peers,
      timeRemaining,
      name,
    };
  }

  remove(id: string): void {
    this.registry.delete(id);
    const t = this.torrents.get(id);
    this.torrents.delete(id);
    if (t) {
      try {
        t.destroy();
      } catch {}
    }
  }

  destroy(): void {
    this.generation++;
    this.stopGuard?.();
    this.stopGuard = null;
    this.clearResume();
    this.registry.clear();
    this.torrents.clear();
    // Never block shutdown on webtorrent's async teardown: hand off the client
    // destroy to a later tick and let the OS reclaim sockets if we exit first.
    const client = this.client;
    this.client = null;
    if (client) {
      setImmediate(() => {
        try {
          client.destroy();
        } catch {}
      });
    }
  }
}
