import { SOURCES } from "../sources/registry";
import { cleanError, exitCode, formatReport, gradeRows, type ProbeReport } from "./probe";
import type { Source, TorrentResult } from "../sources/types";

export const DEFAULT_TIMEOUT_MS = 20_000;

// Sources split into two shapes: most answer an empty query with their
// latest/popular feed (what pressing enter on an empty search box does), while
// a search-only index like BitTorrented returns nothing until it gets a term,
// and a browse-only feed like EZTV returns nothing once it gets one. So the
// probe tries the blank feed first and falls back to one broad term, and only
// calls a source empty when both come back with nothing. The fallback is a
// common word rather than a title, so no probe depends on one release still
// being indexed.
const PROBE_QUERIES = ["", "the"] as const;

export interface DoctorOptions {
  json?: boolean;
  timeoutMs?: number;
  // Injectable for tests; defaults to the real registry.
  sources?: readonly Source[];
  out?: (line: string) => void;
}

type Outcome =
  { kind: "rows"; rows: TorrentResult[] } | { kind: "error"; error: unknown } | { kind: "timeout" };

// Resolves for every outcome, including a source that hangs forever: the probe
// races the search against its own timeout and aborts the signal either way, so
// one wedged host can never stall the whole report. The search promise settles
// into an Outcome before the race, so the loser of the race can never surface
// as an unhandled rejection (see util/crashlog.ts for why that matters).
export async function probeOnce(
  source: Source,
  query: string,
  timeoutMs: number,
): Promise<ProbeReport> {
  const started = Date.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const search: Promise<Outcome> = Promise.resolve()
    .then(() => source.search(query, { signal: controller.signal }))
    .then(
      (rows): Outcome => ({ kind: "rows", rows: Array.isArray(rows) ? rows : [] }),
      (error): Outcome => ({ kind: "error", error }),
    );

  const timeout = new Promise<Outcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
  });

  const outcome = await Promise.race([search, timeout]);
  clearTimeout(timer);
  controller.abort();

  const base = { id: source.id, label: source.label, query, ms: Date.now() - started };
  if (outcome.kind === "rows") return { ...base, ...gradeRows(outcome.rows) };
  return {
    ...base,
    status: "failed",
    rows: 0,
    usable: 0,
    error:
      outcome.kind === "timeout" ? `timed out after ${timeoutMs}ms` : cleanError(outcome.error),
  };
}

// Walks PROBE_QUERIES until one produces rows. Stops early on a failure: a host
// that is down or throwing has already answered the question, and hammering it
// with a second request would not change the answer.
export async function probeSource(source: Source, timeoutMs: number): Promise<ProbeReport> {
  let last: ProbeReport | undefined;
  for (const query of PROBE_QUERIES) {
    last = await probeOnce(source, query, timeoutMs);
    if (last.status !== "empty") return last;
  }
  return last!;
}

export async function probeAll(
  sources: readonly Source[],
  timeoutMs: number,
): Promise<ProbeReport[]> {
  return Promise.all(sources.map((s) => probeSource(s, timeoutMs)));
}

// Prints the report and returns the process exit code. Never throws: a broken
// source is the thing being measured, not a crash.
export async function runDoctor(opts: DoctorOptions = {}): Promise<number> {
  const sources = opts.sources ?? SOURCES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const out = opts.out ?? ((line: string) => console.log(line));

  const reports = await probeAll([...sources], timeoutMs);
  out(opts.json ? JSON.stringify(reports, null, 2) : formatReport(reports));
  return exitCode(reports);
}
