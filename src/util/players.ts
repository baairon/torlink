import { execFileSync, spawn, execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import net from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chromecasts from "chromecasts";

// ponytail: fixed local players; AirPlay via pyatv CLI helper (no native Node deps).
// macOS app bundles (VLC, IINA) aren't on PATH, so probe bundle paths too.
export interface LocalPlayer {
  kind: "local";
  name: string;
  cmd: string;
  args: string[];
}

interface PlayerCandidate {
  name: string;
  args: string[];
  cmd: string;          // PATH binary name
  macBundle?: string;   // macOS app-bundle binary path, e.g. /Applications/VLC.app/Contents/MacOS/VLC
}

const CANDIDATES: PlayerCandidate[] = [
  { name: "VLC", cmd: "vlc", args: ["--play-and-exit", "--quiet"], macBundle: "/Applications/VLC.app/Contents/MacOS/VLC" },
  { name: "mpv", cmd: "mpv", args: ["--really-quiet", "--loop=no"] },
  { name: "IINA", cmd: "iina", args: [], macBundle: "/Applications/IINA.app/Contents/MacOS/iina" },
];

let localCache: LocalPlayer[] | null = null;

export function availableLocalPlayers(): LocalPlayer[] {
  if (localCache) return localCache;
  const probe = process.platform === "win32" ? "where" : "which";
  localCache = [];
  for (const c of CANDIDATES) {
    // macOS app bundle: check the bundle path first (VLC isn't on PATH).
    if (c.macBundle && process.platform === "darwin" && existsSync(c.macBundle)) {
      localCache.push({ kind: "local", name: c.name, cmd: c.macBundle, args: c.args });
      continue;
    }
    try {
      execFileSync(probe, [c.cmd], { stdio: "ignore" });
      localCache.push({ kind: "local", name: c.name, cmd: c.cmd, args: c.args });
    } catch {}
  }
  return localCache;
}

// The LAN IP cast devices use to reach the streaming server (which binds 0.0.0.0).
// Local players keep 127.0.0.1. Cached after first call.
let lanIpCache: string | null | undefined;
export function lanIp(): string | null {
  if (lanIpCache !== undefined) return lanIpCache;
  const nets = networkInterfaces();
  for (const addrs of Object.values(nets)) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) {
        lanIpCache = a.address;
        return a.address;
      }
    }
  }
  lanIpCache = null;
  return null;
}

// Resolve the torrent listing URL to a direct file URL (or .m3u playlist).
// `baseUrl` is the address the target player can reach: 127.0.0.1 for local,
// LAN IP for cast devices.
async function resolveFileUrl(listingUrl: string, baseUrl: string): Promise<string> {
  // Replace the host in the listing URL with the target-reachable host.
  const url = listingUrl.replace("127.0.0.1", baseUrl);
  if (!url.endsWith("/")) return url;
  const res = await fetch(url);
  const html = await res.text();
  const entries = [...html.matchAll(/href="([^"]+)"[^>]*>\s*([^<]+?)\s*<\/a>\s*\((\d+)\s*bytes\)/g)];
  const VIDEO_EXT = /\.(mp4|mkv|webm|avi|mov|m4v|mp3|flac|ogg|opus|wav|m4a)$/i;
  const videos = entries
    .map((m) => ({ href: m[1]!, name: m[2]!, bytes: Number(m[3]!) }))
    .filter((e) => VIDEO_EXT.test(e.name))
    .sort((a, b) => a.bytes - b.bytes);
  if (videos.length > 1) {
    const lines = ["#EXTM3U", ...videos.flatMap((v) => [`#EXTINF:-1,${v.name}`, new URL(encodeURI(v.href), url).href])];
    const { writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const playlistPath = path.join(tmpdir(), `torlnk-${Date.now()}.m3u`);
    writeFileSync(playlistPath, lines.join("\n"));
    return playlistPath;
  }
  if (videos.length === 1) return new URL(encodeURI(videos[0]!.href), url).href;
  const pool = entries.map((m) => ({ href: m[1]!, bytes: Number(m[3]!) }));
  const best = pool.sort((a, b) => b.bytes - a.bytes)[0];
  return best ? new URL(encodeURI(best.href), url).href : url;
}

export function launchLocalPlayer(player: LocalPlayer, url: string): void {
  void (async () => {
    try {
      const fileUrl = await resolveFileUrl(url, "127.0.0.1");
      const isMacBundle = process.platform === "darwin" && player.cmd.startsWith("/Applications/");
      if (isMacBundle) {
        const appName = player.cmd.match(/\/Applications\/(.+?)\.app/)?.[1] ?? player.name;
        const proc = spawn("open", ["-a", appName, fileUrl], { stdio: "ignore", detached: true });
        proc.on("error", () => {});
        proc.unref();
      } else {
        const proc = spawn(player.cmd, [...player.args, fileUrl], { stdio: "ignore", detached: true });
        proc.on("error", () => {});
        proc.unref();
      }
    } catch {}
  })();
}

export interface CastDevice {
  kind: "chromecast" | "airplay";
  name: string;
  id: string;
  play: (url: string) => void;
}

// Lifecycle of a cast, surfaced to the UI. "preparing" covers resolve+probe;
// "transcoding" is the HLS remux buffering ahead; "playing" once the helper
// spawns; "failed" when anything in the chain throws.
export type CastStatus = {
  state: "preparing" | "transcoding" | "playing" | "failed";
  detail?: string;
};

export type CastStatusSink = (status: CastStatus) => void;

// --- AirPlay transcode fallback: tvOS only plays mp4/mov containers or HLS ---

export type AirplayPlan = { mode: "direct" } | { mode: "transcode"; video: "copy" | "encode" };

// `url` may be an http URL or a local file path (multi-file torrents resolve to an .m3u path).
// ponytail: mpegts HLS can't carry HEVC (needs fmp4, which this ATV rejects over
// AirPlay), so hevc is re-encoded to h264 like any other foreign codec. Revisit
// if a per-device segment-type negotiation ever matters.
export function airplayPlan(url: string, vcodec: string | null): AirplayPlan {
  if (/\.(mp4|m4v|mov)$/i.test(url)) return { mode: "direct" };
  if (vcodec === "h264") return { mode: "transcode", video: "copy" };
  if (vcodec === null) return { mode: "direct" }; // ponytail: probe failed, try direct and hope
  return { mode: "transcode", video: "encode" }; // hevc/vp9/av1/mpeg2 etc.
}

function probeVideoCodec(url: string): Promise<string | null> {
  return probeStreams(url).then((s) => s?.vcodec ?? null);
}

interface ProbedStream {
  vcodec: string | null;
  audioLangs: string[]; // per audio stream, language tag or ""
}

function probeStreams(url: string): Promise<ProbedStream | null> {
  return new Promise((resolve) => {
    execFile(
      "ffprobe",
      ["-v", "error", "-show_entries", "stream=codec_name,codec_type:stream_tags=language", "-of", "json", url],
      { timeout: 15000 },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          const streams = JSON.parse(stdout).streams ?? [];
          resolve({
            vcodec: streams.find((s: { codec_type?: string }) => s.codec_type === "video")?.codec_name ?? null,
            audioLangs: streams
              .filter((s: { codec_type?: string }) => s.codec_type === "audio")
              .map((s: { tags?: { language?: string } }) => s.tags?.language ?? ""),
          });
        } catch {
          resolve(null);
        }
      },
    );
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "0.0.0.0", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

// One transcode at a time: a new cast kills the previous ffmpeg/server and
// deletes its temp dir. Concurrent transcodes of the same in-progress torrent
// starve each other (three readers thrash the piece cache) and fill disk.
let activeTranscode: { ff: ReturnType<typeof spawn>; srv: ReturnType<typeof spawn>; dir: string } | null = null;

function stopActiveTranscode(): void {
  if (!activeTranscode) return;
  activeTranscode.ff.kill("SIGKILL");
  activeTranscode.srv.kill("SIGKILL");
  removeDir(activeTranscode.dir);
  activeTranscode = null;
}

function removeDir(dir: string): void {
  try {
    for (const f of readdirSync(dir)) unlinkSync(path.join(dir, f));
    rmdirSync(dir);
  } catch {}
}

// Delete torlnk-cast-* dirs left by crashed runs or killed dev servers. Only
// one transcode is ever active, so any other dir is garbage.
function cleanStaleTranscodeDirs(): void {
  try {
    for (const f of readdirSync(tmpdir())) {
      if (f.startsWith("torlnk-cast-")) removeDir(path.join(tmpdir(), f));
    }
  } catch {}
}
process.on("exit", stopActiveTranscode);

// Build the var_stream_map: one audio-only variant per audio track (stereo aac,
// selectable on the ATV via EXT-X-MEDIA renditions) + one video-only variant.
// The first track is the default; language tags pass through verbatim when present.
export function buildVarStreamMap(audioLangs: string[]): { map: string; defaultIdx: number } {
  const parts = audioLangs.map((lang, i) => {
    const langPart = lang ? `,language:${lang.toUpperCase().slice(0, 3)}` : "";
    return `a:${i},agroup:aud${langPart},default:${i === 0 ? "YES" : "NO"}`;
  });
  parts.push(`v:0,agroup:aud`);
  return { map: parts.join(" "), defaultIdx: 0 };
}

// Transcode to HLS in a temp dir served by python's stdlib http.server; returns
// the playlist URL only after the first segments exist, so the ATV never sees
// an empty playlist. ffmpeg/server are children of this process (not detached),
// so they die with torlnk. // ponytail: disk holds the full remux (~bitrate ×
// runtime); switch to delete_segments live mode if that matters.
async function airplayTranscode(
  url: string,
  video: "copy" | "encode",
  audioLangs: string[],
  onStatus?: CastStatusSink,
): Promise<string> {
  onStatus?.({ state: "transcoding" });
  stopActiveTranscode();
  cleanStaleTranscodeDirs();
  const dir = path.join(tmpdir(), `torlnk-cast-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const port = await freePort();
  const videoArgs = video === "copy" ? ["-c:v", "copy"] : ["-c:v", "libx264", "-preset", "veryfast"];
  // ponytail: mpegts over fmp4 — the only variant this ATV (AppleTV5,3/tvOS 26) actually plays.
  // -readrate 1.5: transcode must outpace playback or the ATV's buffer drains
  // (stutter) on Wi-Fi/torrent hiccups; EVENT playlist keeps all segments so the
  // faster pace doesn't move the join point.
  // Audio goes out as per-track renditions so the ATV's audio menu can switch languages.
  const { map } = buildVarStreamMap(audioLangs);
  const args = ["-y", "-readrate", "1.5", "-i", url, "-map", "0:v:0"];
  for (let i = 0; i < audioLangs.length; i++) args.push("-map", `0:a:${i}`);
  args.push(...videoArgs, "-c:a", "aac", "-b:a", "192k", "-ac", "2",
    "-f", "hls", "-hls_time", "2", "-hls_playlist_type", "event",
    "-hls_segment_type", "mpegts", "-master_pl_name", "master.m3u8",
    "-var_stream_map", map, path.join(dir, "%v", "stream.m3u8"));
  const ff = spawn("ffmpeg", args, { stdio: "ignore" });
  ff.on("error", () => {});
  const srv = spawn("python3", ["-m", "http.server", String(port), "--bind", "0.0.0.0", "--directory", dir], {
    stdio: "ignore",
  });
  srv.on("error", () => {});
  activeTranscode = { ff, srv, dir };
  // Wait until ffmpeg has written the master playlist (it appears after all
  // variant playlists have segments) or died.
  const master = path.join(dir, "master.m3u8");
  for (let i = 0; i < 150; i++) {
    if (ff.exitCode !== null) throw new Error("ffmpeg failed to transcode (is it installed?)");
    if (existsSync(master)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!existsSync(master)) throw new Error("transcode did not produce a playlist in time");
  const ip = lanIp() ?? "127.0.0.1";
  return `http://${ip}:${port}/master.m3u8`;
}

// Stop the active cast (kills transcode processes, frees the temp dir). Safe to
// call when nothing is active. Exposed so the UI can offer a stop key.
export function stopActiveCast(): void {
  stopActiveTranscode();
}

export function activeCastKind(): "airplay" | "chromecast" | null {
  return activeTranscode ? "airplay" : castsInstance ? "chromecast" : null;
}

// --- Chromecast (pure JS, via the chromecasts npm package) ---

let castsInstance: ReturnType<typeof chromecasts> | null = null;

// Walk up from this module to the package root to find scripts/airplay.py.
// The bundled build flattens to dist/index.js while dev runs from src/util/,
// so a fixed relative path only works for one of the two.
export function findHelperScript(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "scripts", "airplay.py");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join("scripts", "airplay.py");
}

export function startCastDiscovery(
  onDevice: (device: CastDevice) => void,
  onStatus?: CastStatusSink,
): () => void {
  castsInstance?.destroy();
  const casts = chromecasts();
  castsInstance = casts;
  const helperScript = findHelperScript();
  const onUpdate = (player: { name: string; play: (url: string, opts: { title: string }, cb: (err?: Error) => void) => void }): void =>
    onDevice({
      kind: "chromecast",
      name: player.name,
      id: player.name,
      play: (url: string) => {
        void (async () => {
          const ip = lanIp();
          const castUrl = ip ? url.replace("127.0.0.1", ip) : url;
          const fileUrl = await resolveFileUrl(castUrl, ip ?? "127.0.0.1");
          player.play(fileUrl, { title: "torlnk" }, () => {});
        })();
      },
    });
  casts.on("update", onUpdate);

  // --- AirPlay (via pyatv Python helper, if available) ---
  let airplayStop: (() => void) | null = null;
  const pyatvCompatDir = process.env.TORLINK_PYATV_COMPAT_DIR ?? "/Users/samuelhearn/iptv";
  // Find a python with pyatv installed: try the iptv venv first, then system.
  const pyCandidates = ["/Users/samuelhearn/iptv/venv/bin/python", "python3"];
  let pyBin: string | null = null;
  for (const p of pyCandidates) {
    try {
      execFileSync(p, ["-c", "import pyatv"], { stdio: "ignore", env: { ...process.env, PYTHONPATH: pyatvCompatDir } });
      pyBin = p;
      break;
    } catch {}
  }
  if (pyBin) {
    const env = { ...process.env, PYTHONPATH: pyatvCompatDir };
    execFile(pyBin, [helperScript, "scan"], { env, timeout: 10000 }, (err, stdout) => {
      if (err) return;
      for (const line of stdout.trim().split("\n")) {
        const [id, name] = line.split("\t");
        if (id && name) {
          onDevice({
            kind: "airplay",
            name: `AirPlay: ${name}`,
            id,
            play: (url: string) => {
              void (async () => {
                try {
                  onStatus?.({ state: "preparing" });
                  const ip = lanIp();
                  const castUrl = ip ? url.replace("127.0.0.1", ip) : url;
                  const fileUrl = await resolveFileUrl(castUrl, ip ?? "127.0.0.1");
                  const probe = await probeStreams(fileUrl);
                  const plan = airplayPlan(fileUrl, probe?.vcodec ?? null);
                  const finalUrl =
                    plan.mode === "transcode"
                      ? await airplayTranscode(fileUrl, plan.video, probe?.audioLangs ?? [], onStatus)
                      : fileUrl;
                  const proc = spawn(pyBin!, [helperScript, "play", id, finalUrl], {
                    stdio: "ignore", detached: true, env,
                  });
                  proc.on("error", () => {});
                  proc.unref();
                  onStatus?.({ state: "playing" });
                } catch (e) {
                  onStatus?.({ state: "failed", detail: e instanceof Error ? e.message : String(e) });
                }
              })();
            },
          });
        }
      }
    });
  }

  return () => {
    if (castsInstance === casts) castsInstance = null;
    casts.off("update", onUpdate);
    casts.destroy();
  };
}
