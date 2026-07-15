import { USER_AGENT, type FetchImpl } from "../util/net";
import type { SourceGroup } from "../sources/types";
import type { Command } from "./commands";
import type { GatewayInteraction } from "./gateway";

const API = "https://discord.com/api/v10";

// Option type 3 = STRING. Slash commands carry their arguments as named options,
// so there's no text to parse; the options map straight onto our Command.
// Category is a choices dropdown shown before the query, so a search is: pick
// what kind of thing, then type what you're after.
const CATEGORY_CHOICES = [
  { name: "All sources", value: "all" },
  { name: "🎮 Games", value: "Games" },
  { name: "🎬 Movies", value: "Movies" },
  { name: "📺 TV", value: "TV" },
  { name: "🍥 Anime", value: "Anime" },
];

export const SLASH_COMMANDS = [
  {
    name: "search",
    description: "Search for a torrent",
    options: [
      { name: "category", description: "What kind of thing", type: 3, required: true, choices: CATEGORY_CHOICES },
      { name: "query", description: "What to look for", type: 3, required: true },
    ],
  },
  {
    name: "add",
    description: "Download a result from your last /search, or a magnet / info hash",
    options: [{ name: "item", description: "Result number, magnet link, or info hash", type: 3, required: true }],
  },
  { name: "status", description: "Show active downloads and seeds" },
  {
    name: "cancel",
    description: "Cancel a download by its /status number",
    options: [{ name: "item", description: "Download number from /status", type: 3, required: true }],
  },
  { name: "help", description: "Show torlink's commands" },
];

const INTERACTION_APPLICATION_COMMAND = 2;
const CALLBACK_DEFERRED = 5; // ack now, edit the reply once the work is done
const CALLBACK_MESSAGE = 4;
const CALLBACK_UPDATE_MESSAGE = 7; // edit the component's own message in place
const FLAG_EPHEMERAL = 64;

export interface ReplyPayload {
  content?: string;
  embeds?: unknown[];
  components?: unknown[];
}

export interface DiscordIds {
  applicationId: string;
  guildId: string;
}

async function botGet(path: string, token: string, fetchImpl: FetchImpl): Promise<Response> {
  return fetchImpl(`${API}${path}`, {
    headers: { Authorization: `Bot ${token}`, "User-Agent": USER_AGENT },
  });
}

// The application id (== bot user id) and the guild that owns the command
// channel. Both are needed to register guild commands and to edit deferred replies.
export async function resolveIds(
  channelId: string,
  token: string,
  fetchImpl: FetchImpl = fetch,
): Promise<DiscordIds> {
  const meRes = await botGet("/users/@me", token, fetchImpl);
  if (!meRes.ok) throw new Error(`/users/@me HTTP ${meRes.status}`);
  const applicationId = ((await meRes.json()) as { id: string }).id;

  const chRes = await botGet(`/channels/${channelId}`, token, fetchImpl);
  if (!chRes.ok) throw new Error(`/channels HTTP ${chRes.status} (is the bot in that server?)`);
  const guildId = ((await chRes.json()) as { guild_id?: string }).guild_id ?? "";
  if (!guildId) throw new Error("that channel isn't in a server");
  return { applicationId, guildId };
}

// Register the commands on the guild (guild scope shows up instantly, unlike the
// up-to-an-hour global cache). Needs the bot to have joined with the
// applications.commands scope.
export async function registerGuildCommands(
  ids: DiscordIds,
  token: string,
  fetchImpl: FetchImpl = fetch,
): Promise<void> {
  const res = await fetchImpl(`${API}/applications/${ids.applicationId}/guilds/${ids.guildId}/commands`, {
    method: "PUT",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify(SLASH_COMMANDS),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`register commands HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
}

export function interactionUserId(i: GatewayInteraction): string | undefined {
  return i.member?.user?.id ?? i.user?.id;
}

export function interactionToCommand(i: GatewayInteraction): Command | null {
  if (i.type !== INTERACTION_APPLICATION_COMMAND || !i.data?.name) return null;
  const opt = (name: string): string =>
    String(i.data?.options?.find((o) => o.name === name)?.value ?? "").trim();
  switch (i.data.name) {
    case "search": {
      const category = opt("category");
      const group = category && category !== "all" ? (category as SourceGroup) : undefined;
      return { kind: "search", query: opt("query"), group };
    }
    case "add":
      return { kind: "add", arg: opt("item") };
    case "status":
      return { kind: "status" };
    case "cancel":
      return { kind: "cancel", arg: opt("item") };
    case "help":
      return { kind: "help" };
    default:
      return null;
  }
}

// Ack within Discord's 3s window; the real reply is edited in once the command
// finishes (a search can take longer than that).
export async function deferReply(i: GatewayInteraction, fetchImpl: FetchImpl = fetch): Promise<void> {
  await fetchImpl(`${API}/interactions/${i.id}/${i.token}/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({ type: CALLBACK_DEFERRED }),
  });
}

// Fill in the deferred reply once the command has run.
export async function editReply(
  applicationId: string,
  i: GatewayInteraction,
  payload: ReplyPayload,
  fetchImpl: FetchImpl = fetch,
): Promise<void> {
  await fetchImpl(`${API}/webhooks/${applicationId}/${i.token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify(payload),
  });
}

// Immediate reply, for the fast dropdown "add" (no deferral needed).
export async function respondMessage(
  i: GatewayInteraction,
  payload: ReplyPayload,
  fetchImpl: FetchImpl = fetch,
): Promise<void> {
  await fetchImpl(`${API}/interactions/${i.id}/${i.token}/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({ type: CALLBACK_MESSAGE, data: payload }),
  });
}

// Edit the message a component is attached to in place, so the pager buttons swap
// the results embed to another page without posting a new message.
export async function updateMessage(
  i: GatewayInteraction,
  payload: ReplyPayload,
  fetchImpl: FetchImpl = fetch,
): Promise<void> {
  await fetchImpl(`${API}/interactions/${i.id}/${i.token}/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({ type: CALLBACK_UPDATE_MESSAGE, data: payload }),
  });
}

// A one-shot ephemeral reply, for the rejection path (no deferral needed).
export async function replyEphemeral(
  i: GatewayInteraction,
  content: string,
  fetchImpl: FetchImpl = fetch,
): Promise<void> {
  await fetchImpl(`${API}/interactions/${i.id}/${i.token}/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({ type: CALLBACK_MESSAGE, data: { content, flags: FLAG_EPHEMERAL } }),
  });
}
