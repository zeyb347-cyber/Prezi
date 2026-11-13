import {
  EmbedBuilder,
  type Guild,
  type TextBasedChannel,
} from "discord.js";
import type { GuildSettings } from "@workspace/db";
import { logger } from "../logger";
import { addModerationLog, updateModerationLog } from "./store";

export type AuditEntry = {
  guildId: string;
  actorId: string;
  actorTag: string;
  targetId?: string | null;
  targetTag?: string | null;
  commandName: string;
  category?: string;
  reason?: string | null;
  duration?: string | null;
  success: boolean;
  details?: string | null;
};

const LOG_CATEGORY: Record<string, string> = {
  ban: "sanctions",
  unban: "sanctions",
  kick: "sanctions",
  timeout: "sanctions",
  untimeout: "sanctions",
  warn: "warnings",
  warnings: "warnings",
  clearwarns: "warnings",
  deletewarn: "warnings",
  addrole: "roles",
  removerole: "roles",
  nick: "roles",
  clear: "messages",
  lock: "messages",
  unlock: "messages",
  slowmode: "messages",
  setup: "settings",
  userinfo: "information",
  serverinfo: "information",
  avatar: "information",
  roleinfo: "information",
};

export async function recordAudit(
  guild: Guild,
  settings: GuildSettings,
  entry: AuditEntry,
): Promise<void> {
  const recordId = await addModerationLog(entry);
  await postAuditEmbed(guild, settings, entry, recordId);
}

export async function finishAudit(
  guild: Guild,
  settings: GuildSettings,
  entry: AuditEntry,
  recordId: number,
): Promise<void> {
  await updateModerationLog(
    recordId,
    entry.success,
    entry.details ?? null,
  );
  await postAuditEmbed(guild, settings, entry, recordId);
}

async function postAuditEmbed(
  guild: Guild,
  settings: GuildSettings,
  entry: AuditEntry,
  recordId: number,
): Promise<void> {
  const category = entry.category ?? LOG_CATEGORY[entry.commandName] ?? "sanctions";

  if (
    !settings.logChannelId ||
    !settings.logTypes.includes(category) ||
    !guild.client.isReady()
  ) {
    return;
  }

  const channel = await guild.channels
    .fetch(settings.logChannelId)
    .catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) {
    logger.warn(
      { guildId: guild.id, channelId: settings.logChannelId },
      "Configured moderation log channel is unavailable",
    );
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(entry.success ? 0x23866d : 0xc84848)
    .setTitle(entry.success ? "سجل إداري — نجاح" : "سجل إداري — فشل")
    .addFields(
      { name: "الإداري", value: `<@${entry.actorId}>`, inline: true },
      {
        name: "العضو المستهدف",
        value: entry.targetId ? `<@${entry.targetId}>` : "—",
        inline: true,
      },
      { name: "الأمر", value: `/${entry.commandName}`, inline: true },
      { name: "السبب", value: entry.reason || "لم يُذكر", inline: false },
      {
        name: "المدة",
        value: entry.duration || "—",
        inline: true,
      },
      {
        name: "النتيجة",
        value: entry.success ? "ناجح" : "فشل",
        inline: true,
      },
      ...(entry.details
        ? [{ name: "التفاصيل", value: entry.details.slice(0, 900), inline: false }]
        : []),
    )
    .setFooter({ text: `سجل #${recordId} · ${entry.actorTag}` })
    .setTimestamp(new Date());

  try {
    await (channel as TextBasedChannel & { send: (options: unknown) => Promise<unknown> }).send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    logger.warn(
      { err: error, guildId: guild.id, channelId: channel.id },
      "Could not post moderation audit embed",
    );
  }
}
