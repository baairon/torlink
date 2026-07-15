import type { SourceGroup } from "../sources/types";

// A command the bridge can run, decoded from a slash interaction (see slash.ts).
// The kinds line up with what the daemon does against the download runtime.
export type Command =
  | { kind: "search"; query: string; group?: SourceGroup }
  | { kind: "add"; arg: string }
  | { kind: "status" }
  | { kind: "cancel"; arg: string }
  | { kind: "help" };
