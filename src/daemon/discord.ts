// Headless Discord doorway: drive the same download runtime as `serve`, but the
// interface is a Discord channel. Notifications go out through a webhook; when a
// bot token + channel + allowlist are configured, it also registers slash
// commands (/search, /add, /status, /cancel, /help) and answers them in real
// time over the gateway. One mutating daemon at a time, like serve and watch.

import { startRuntime, type Runtime } from "./runtime";
import { startSeedReaper } from "./seed-reaper";
import { loadConfig } from "../config/config";
import { resolveDiscord, canNotify, canTakeCommands, type ResolvedDiscord } from "../discord/config";
import { attachNotifications } from "../discord/notify";
import { executeCommand, addByInfoHash, pageSearch, newUserState, type UserState } from "../discord/execute";
import { postWebhook } from "../discord/webhook";
import { SELECT_ADD_ID, PAGE_PREV_ID, PAGE_NEXT_ID, errorEmbed } from "../discord/embeds";
import { startGateway, type GatewayInteraction } from "../discord/gateway";
import {
  resolveIds,
  registerGuildCommands,
  interactionToCommand,
  interactionUserId,
  deferReply,
  editReply,
  respondMessage,
  updateMessage,
  replyEphemeral,
  type DiscordIds,
} from "../discord/slash";
import { VERSION } from "../version";

export interface DiscordOptions {
  downloadDir?: string;
  seedTimeMs?: number;
  deleteFiles?: boolean;
}

const COMPONENT_INTERACTION = 3;

function log(message: string): void {
  console.log(`[torlnk discord] ${new Date().toISOString()} ${message}`);
}

function makeInteractionHandler(runtime: Runtime, discord: ResolvedDiscord, ids: DiscordIds) {
  const states = new Map<string, UserState>();
  const stateFor = (userId: string): UserState => {
    let s = states.get(userId);
    if (!s) {
      s = newUserState();
      states.set(userId, s);
    }
    return s;
  };

  return (i: GatewayInteraction): void => {
    void (async () => {
      const userId = interactionUserId(i);
      if (!userId || !discord.allowedUserIds.includes(userId)) {
        await replyEphemeral(i, "You're not on this bot's allowlist.").catch(() => {});
        log(`rejected an interaction from ${userId ?? "unknown"} (not allowlisted)`);
        return;
      }
      const state = stateFor(userId);

      // Dropdown pick and pager buttons answer directly (both are quick).
      if (i.type === COMPONENT_INTERACTION) {
        const customId = i.data?.custom_id;
        try {
          if (customId === PAGE_PREV_ID || customId === PAGE_NEXT_ID) {
            // No live search (e.g. the daemon restarted since this message).
            // Still acknowledge, or Discord marks the click "interaction failed".
            const reply = pageSearch(state, customId === PAGE_NEXT_ID ? 1 : -1);
            if (reply) await updateMessage(i, reply);
            else await replyEphemeral(i, "That search expired. Run /search again.");
          } else if (customId === SELECT_ADD_ID) {
            await respondMessage(i, await addByInfoHash(i.data?.values?.[0] ?? "", runtime, state));
            log(`select add from ${userId}`);
          }
        } catch (e) {
          log(`component failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        return;
      }

      const cmd = interactionToCommand(i);
      if (!cmd) return;
      // A search can outrun the 3s window, so ack first and fill the reply in.
      // Edit on failure too, so the reply never sticks on "thinking".
      await deferReply(i).catch(() => {});
      try {
        await editReply(ids.applicationId, i, await executeCommand(cmd, runtime, state));
        log(`/${i.data?.name} from ${userId}`);
      } catch (e) {
        log(`/${i.data?.name} failed: ${e instanceof Error ? e.message : String(e)}`);
        await editReply(ids.applicationId, i, { embeds: [errorEmbed("Something went wrong running that.")] }).catch(
          () => {},
        );
      }
    })();
  };
}

export async function runDiscord(options: DiscordOptions = {}): Promise<void> {
  const discord = resolveDiscord(await loadConfig());

  if (!canNotify(discord)) {
    console.error(
      "error: Discord isn't set up. Add a webhook URL (and, for commands, a bot token, " +
        "channel id, and allowed user ids) with the TUI's Discord screen, the config file, " +
        "or the TORLINK_DISCORD_* environment variables.",
    );
    process.exit(1);
    return;
  }

  const runtime = await startRuntime(options.downloadDir);

  if (options.seedTimeMs && options.seedTimeMs > 0) {
    startSeedReaper(runtime.queue, options.seedTimeMs, { deleteFiles: options.deleteFiles, log });
  }

  const detachNotify = attachNotifications(runtime.queue, discord.webhookUrl!, log);

  let stopGateway: (() => void) | null = null;
  if (canTakeCommands(discord)) {
    try {
      const ids = await resolveIds(discord.channelId!, discord.botToken!);
      await registerGuildCommands(ids, discord.botToken!);
      log(`registered slash commands in guild ${ids.guildId}`);
      const handle = startGateway({
        token: discord.botToken!,
        onInteraction: makeInteractionHandler(runtime, discord, ids),
        log,
      });
      stopGateway = handle.stop;
      log("commands enabled: slash commands live over the gateway");
    } catch (e) {
      // Notifications still work; a command-setup problem shouldn't take the
      // whole daemon down, just say why and carry on.
      log(`commands disabled: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    log("notifications only: add a bot token, channel id, and allowlist to enable commands");
  }

  log(`online as torlink v${VERSION} (downloads -> ${runtime.downloadDir})`);
  void postWebhook(
    discord.webhookUrl!,
    `torlink v${VERSION} online${stopGateway ? ", try `/help`" : ""}`,
    { log },
  );

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      stopGateway?.();
      detachNotify();
      runtime.queue.suspend();
      resolve();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}
