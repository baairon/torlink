import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { logsDir } from "../config/paths";

export const crashLogFile = path.join(logsDir, "crash.log");

// Append one timestamped entry. Returns false when even logging failed: a
// crash logger must never become a crash source itself.
export function logCrash(kind: string, err: unknown): boolean {
  try {
    mkdirSync(logsDir, { recursive: true });
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    appendFileSync(crashLogFile, `${new Date().toISOString()} [${kind}] ${detail}\n`);
    return true;
  } catch {
    return false;
  }
}

// Node kills the process on any unhandled promise rejection, and webtorrent
// can produce one from inside its own async internals with no error event and
// nothing a caller's try/catch can reach (its fire-and-forget _onTorrentId is
// where the Jul-2026 uint8-util drift detonated on every boot). Registering a
// listener flips that default from process death to a contained event: the
// torrent whose startup blew up stays visibly stalled, everything else lives.
// Every occurrence lands in crash.log; `echo` additionally mirrors one line
// to stderr for headless runs (the TUI never echoes, a stray write would tear
// the alt screen).
export function containUnhandledRejections(opts: { echo?: boolean } = {}): void {
  process.on("unhandledRejection", (reason) => {
    logCrash("unhandledRejection", reason);
    if (opts.echo) {
      const msg = reason instanceof Error ? reason.message : String(reason);
      console.error(`[torlnk] recovered from a background error: ${msg}`);
    }
  });
}
