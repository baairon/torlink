export type DelugeSendResult =
  | { ok: true; status: "added" | "already-added" }
  | { ok: false; reason: "not-configured" | "auth-failed" | "unreachable" | "error"; message: string };
