import {
  Client,
  Events,
  GatewayIntentBits,
  type Guild,
} from "discord.js";
import type { GuildSettings } from "@workspace/db";
import { logger } from "../logger";
import { COMMAND_CATALOG, buildGuildCommands } from "./commands";
import { handleModerationCommand, handleModerationComponent } from "./executor";
import { handleSetupComponent } from "./setup";
import { getGuildSettings } from "./store";

let discordClient: Client | null = null;
let startedAt: number | null = null;
let startAttempted = false;
const recentComponentActions = new Map<string, number>();

async function syncGuild(guild: Guild): Promise<void> {
  const settings: GuildSettings = await getGuildSettings(guild.id);
  await guild.commands.set(buildGuildCommands(settings));
  logger.info(
    { guildId: guild.id, commandCount: buildGuildCommands(settings).length },
    "Registered moderation slash commands",
  );
}

export function startDiscordBot(): void {
  if (startAttempted) return;
  startAttempted = true;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    logger.error("DISCORD_BOT_TOKEN is missing; Discord bot did not start");
    return;
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });
  discordClient = client;

  client.once(Events.ClientReady, async (readyClient) => {
    startedAt = Date.now();
    logger.info(
      { botId: readyClient.user.id, guildCount: readyClient.guilds.cache.size },
      "Discord moderation bot connected",
    );
    for (const guild of readyClient.guilds.cache.values()) {
      try {
        await syncGuild(guild);
      } catch (error) {
        logger.error(
          { err: error, guildId: guild.id },
          "Could not register moderation commands in guild",
        );
      }
    }
  });

  client.on(Events.GuildCreate, async (guild) => {
    try {
      await syncGuild(guild);
    } catch (error) {
      logger.error(
        { err: error, guildId: guild.id },
        "Could not register commands after joining a guild",
      );
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
        const selectedValues = interaction.isStringSelectMenu()
          ? interaction.values.join(",")
          : interaction.isRoleSelectMenu() || interaction.isChannelSelectMenu()
            ? interaction.values.join(",")
            : "";
        const key = `${interaction.guildId ?? "dm"}:${interaction.user.id}:${interaction.customId}:${selectedValues}`;
        const now = Date.now();
        for (const [cachedKey, timestamp] of recentComponentActions) {
          if (now - timestamp > 2_000) recentComponentActions.delete(cachedKey);
        }
        const previous = recentComponentActions.get(key);
        if (previous && now - previous < 1_500) {
          await interaction.reply({
            content: "تم استقبال هذا الطلب بالفعل.",
            ephemeral: true,
          }).catch(() => undefined);
          return;
        }
        recentComponentActions.set(key, now);
      }
      if (interaction.isChatInputCommand()) {
        await handleModerationCommand(interaction);
        return;
      }
      if (interaction.isButton()) {
        if (await handleModerationComponent(interaction)) return;
      }
      await handleSetupComponent(interaction);
    } catch (error) {
      logger.error(
        {
          err: error,
          guildId: interaction.guildId,
          interactionType: interaction.type,
        },
        "Unhandled Discord interaction error",
      );
      if (interaction.isRepliable()) {
        if (interaction.deferred || interaction.replied) {
          await interaction
            .followUp({
              content: "حدث خطأ تقني. لم يُنفّذ الإجراء إذا فشل التحقق.",
              ephemeral: true,
            })
            .catch(() => undefined);
        } else if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
          await interaction
            .reply({
              content: "حدث خطأ تقني. لم يُنفّذ الإجراء إذا فشل التحقق.",
              ephemeral: true,
            })
            .catch(() => undefined);
        }
      }
    }
  });

  client.on(Events.Error, (error) => {
    logger.error({ err: error }, "Discord gateway client error");
  });

  void client.login(token).catch((error: unknown) => {
    logger.error({ err: error }, "Discord bot login failed");
    discordClient = null;
  });
}

export function getBotOverview() {
  const ready = discordClient?.isReady() ?? false;
  const user = ready ? discordClient?.user : null;
  return {
    connected: ready,
    guildCount: ready ? discordClient?.guilds.cache.size ?? 0 : 0,
    botTag: user?.tag ?? null,
    applicationId: user?.id ?? null,
    commandCount: COMMAND_CATALOG.length,
    commands: COMMAND_CATALOG.map(({ name, description, category }) => ({
      name,
      description,
      category,
    })),
  };
}

export function getBotUptimeSeconds(): number | null {
  if (!discordClient?.isReady() || !startedAt) return null;
  return Math.floor((Date.now() - startedAt) / 1000);
}

