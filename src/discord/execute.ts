// Runs a resolved command against the download runtime and returns a Discord
// reply (embed, plus the dropdown + pager for /search). The UI-agnostic half of
// the bridge; the daemon owns how the command arrived and how the reply is sent.

import { searchAll } from "../sources/search";
import { addInput, type Runtime } from "../daemon/runtime";
import { parseInput } from "../sources/magnet";
import type { Command } from "./commands";
import type { SourceGroup, TorrentResult } from "../sources/types";
import {
  Embed,
  MAX_RESULTS,
  PAGE_SIZE,
  addedEmbed,
  cancelledEmbed,
  errorEmbed,
  helpEmbed,
  searchComponents,
  searchEmbed,
  statusEmbed,
} from "./embeds";

// Per-user so one person's /add 2 and /cancel 1 refer to what they just saw, and
// the pager remembers which page they're on.
export interface SearchState {
  query: string;
  group?: SourceGroup;
  results: TorrentResult[];
  total: number;
  page: number;
}
export interface UserState {
  search: SearchState | null;
  lastStatusIds: string[];
}
export function newUserState(): UserState {
  return { search: null, lastStatusIds: [] };
}

export interface Reply {
  embeds: Embed[];
  components?: unknown[];
}

// Render the current page of a search, reused by the initial /search and by the
// prev/next buttons. Clamps the page so it can't run off either end.
export function renderSearch(s: SearchState): Reply {
  const totalPages = Math.max(1, Math.ceil(s.results.length / PAGE_SIZE));
  s.page = Math.min(Math.max(0, s.page), totalPages - 1);
  const start = s.page * PAGE_SIZE;
  const window = s.results.slice(start, start + PAGE_SIZE);
  return {
    embeds: [searchEmbed(s.query, window, s.total, start, s.group, s.page, totalPages)],
    components: searchComponents(window, start, s.page, totalPages),
  };
}

export function pageSearch(state: UserState, direction: -1 | 1): Reply | null {
  if (!state.search) return null;
  state.search.page += direction;
  return renderSearch(state.search);
}

export async function executeCommand(
  cmd: Command,
  runtime: Runtime,
  state: UserState,
  deps: { search?: typeof searchAll } = {},
): Promise<Reply> {
  const search = deps.search ?? searchAll;
  switch (cmd.kind) {
    case "help":
      return { embeds: [helpEmbed()] };

    case "search": {
      const all = await search(cmd.query, cmd.group ? { group: cmd.group } : {});
      state.search = {
        query: cmd.query,
        group: cmd.group,
        results: all.slice(0, MAX_RESULTS),
        total: all.length,
        page: 0,
      };
      return renderSearch(state.search);
    }

    case "add": {
      if (/^\d+$/.test(cmd.arg)) {
        const pick = state.search?.results[Number.parseInt(cmd.arg, 10) - 1];
        if (!pick) return { embeds: [errorEmbed(`No result #${cmd.arg}. Run /search first.`)] };
        return { embeds: [addedEmbed(await addInput(runtime, pick.magnet), pick.name)] };
      }
      const name = parseInput(cmd.arg)?.name ?? cmd.arg;
      return { embeds: [addedEmbed(await addInput(runtime, cmd.arg), name)] };
    }

    case "status": {
      const items = runtime.queue.getItems();
      state.lastStatusIds = items.map((it) => it.id);
      const downloads = items.map((it) => ({ name: it.name, status: it.status, progress: it.progress }));
      const seeds = runtime.queue.getSeeds().map((s) => ({ name: s.name, status: s.status }));
      return { embeds: [statusEmbed(downloads, seeds)] };
    }

    case "cancel": {
      const id = /^\d+$/.test(cmd.arg)
        ? state.lastStatusIds[Number.parseInt(cmd.arg, 10) - 1]
        : cmd.arg;
      if (!id) return { embeds: [errorEmbed(`No download #${cmd.arg}. Run /status first.`)] };
      const item = runtime.queue.getItems().find((it) => it.id === id || it.id.startsWith(id));
      if (!item) return { embeds: [errorEmbed("No matching download.")] };
      runtime.queue.cancel(item.id);
      return { embeds: [cancelledEmbed(item.name)] };
    }
  }
}

// The /search dropdown resolves to a download here: find the picked info hash in
// the user's current results and queue its magnet.
export async function addByInfoHash(
  infoHash: string,
  runtime: Runtime,
  state: UserState,
): Promise<Reply> {
  const pick = state.search?.results.find((r) => r.infoHash === infoHash);
  if (!pick) return { embeds: [errorEmbed("That result expired. Run /search again.")] };
  return { embeds: [addedEmbed(await addInput(runtime, pick.magnet), pick.name)] };
}
