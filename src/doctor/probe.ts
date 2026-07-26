import { isInfoHash } from "../sources/magnet";
import { stripControl, truncate } from "../util/format";
import type { SourceId, TorrentResult } from "../sources/types";

// A source is graded, not just pinged. "empty" and "malformed" both mean the
// site answered and torlink still got nothing usable out of it, which is what a
// markup change actually looks like from the outside: no exception, no bad
// status, just rows that stopped parsing.
export type ProbeStatus = "ok" | "empty" | "malformed" | "failed";

export interface ProbeReport {
  id: SourceId;
  label: string;
  status: ProbeStatus;
  // The query that produced this answer. Blank means the source's latest feed;
  // a term means it only answers searches (see PROBE_QUERIES in run.ts).
  query: string;
  // Rows the source returned, and how many of those survived validation.
  rows: number;
  usable: number;
  ms: number;
  error?: string;
}

// Below this share of usable rows the parse is treated as broken rather than
// merely lossy. A source that drifts from 50/50 to 3/50 has changed shape even
// though it still returns something.
export const MIN_USABLE_RATIO = 0.5;

// The longest error text a report carries. Source errors can quote a server
// response, so they are truncated and stripped of control characters before
// they ever reach a terminal (see stripControl in util/format).
const MAX_ERROR_LEN = 120;

export function cleanError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return truncate(stripControl(raw).replace(/\s+/g, " ").trim(), MAX_ERROR_LEN) || "unknown error";
}

// A row is usable when every field the UI depends on is present and well
// formed. Zero seeders and zero size are legitimate (sources with
// reportsHealth: false report no swarm data at all), so neither is checked for
// a value, only for being a finite non-negative number.
export function isUsableRow(r: TorrentResult): boolean {
  if (!r || typeof r !== "object") return false;
  if (!isInfoHash(r.infoHash ?? "")) return false;
  if (typeof r.name !== "string" || r.name.trim() === "") return false;
  if (typeof r.magnet !== "string" || !/^magnet:\?/i.test(r.magnet)) return false;
  for (const n of [r.sizeBytes, r.seeders, r.leechers]) {
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return false;
  }
  return true;
}

export function gradeRows(rows: readonly TorrentResult[]): {
  status: ProbeStatus;
  rows: number;
  usable: number;
} {
  const usable = rows.filter(isUsableRow).length;
  if (rows.length === 0) return { status: "empty", rows: 0, usable: 0 };
  const status = usable / rows.length >= MIN_USABLE_RATIO ? "ok" : "malformed";
  return { status, rows: rows.length, usable };
}

export function isHealthy(report: ProbeReport): boolean {
  return report.status === "ok";
}

// 0 when every source is healthy, 1 otherwise, so a scheduled CI run fails on
// the first source that stops parsing.
export function exitCode(reports: readonly ProbeReport[]): number {
  return reports.every(isHealthy) ? 0 : 1;
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function padStart(s: string, width: number): string {
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

// The trailing note on a row: why it failed, or which fallback query it needed.
function note(r: ProbeReport): string {
  if (r.error) return r.error;
  return r.query ? `search only, matched on "${r.query}"` : "";
}

// Plain ASCII on purpose: this renders into a CI log as often as a terminal.
// Keyed by source id rather than label because two sources can share a label
// (The Pirate Bay feeds both the movies and TV tabs) and a diagnostic has to
// name exactly one of them.
export function formatReport(reports: readonly ProbeReport[]): string {
  const headers = ["source", "status", "rows", "usable", "time"];
  const rows = reports.map((r) => [r.id, r.status, String(r.rows), String(r.usable), `${r.ms}ms`]);

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((cells) => cells[i]!.length)),
  );

  const line = (cells: string[]): string =>
    [
      pad(cells[0]!, widths[0]!),
      pad(cells[1]!, widths[1]!),
      padStart(cells[2]!, widths[2]!),
      padStart(cells[3]!, widths[3]!),
      padStart(cells[4]!, widths[4]!),
    ].join("  ");

  const out = [line(headers)];
  reports.forEach((r, i) => {
    const n = note(r);
    out.push(line(rows[i]!) + (n ? `  ${n}` : ""));
  });

  const bad = reports.filter((r) => !isHealthy(r));
  out.push("");
  out.push(
    bad.length === 0
      ? `all ${reports.length} sources healthy`
      : `${bad.length} of ${reports.length} sources unhealthy: ${bad.map((r) => r.id).join(", ")}`,
  );
  return out.join("\n");
}
