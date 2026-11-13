import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionsBitField,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type GuildBasedChannel,
  type NewsChannel,
  type Role,
  type TextChannel,
  type User,
} from "discord.js";
import type { GuildSettings } from "@workspace/db";
import type { WarningRecord } from "@workspace/db";
import { logger } from "../logger";
import { finishAudit, recordAudit, type AuditEntry } from "./audit";
import { COMMAND_BY_NAME } from "./commands";
import {
  assertBotCanManageMember,
  assertBotCanManageRole,
  assertRoleBelowActor,
  assertTargetBelowActor,
  canUseCommand,
  fetchActorMember,
  ModerationError,
  requireBotPermission,
} from "./guards";
import {
  addWarning,
  clearWarnings,
  deleteWarning,
  getGuildSettings,
  getWarning,
  listWarnings,
  startModerationLog,
} from "./store";

const EPHEMERAL = true;
const MAX_TIMEOUT_SECONDS = 2_419_200;
const CONFIRMATION_TTL_MS = 90_000;
const confirmations = new Map<
  string,
  {
    actorId: string;
    guildId: string;
    expiresAt: number;
    interaction: ChatInputCommandInteraction;
    commandName: string;
    actionKey: string;
  }
>();
type ModerationTextChannel = TextChannel | NewsChannel;
const activeActionKeys = new Set<string>();
const recentActionKeys = new Map<string, number>();
const MUTATING_COMMANDS = new Set([
  "ban",
  "unban",
  "kick",
  "timeout",
  "untimeout",
  "warn",
  "clearwarns",
  "deletewarn",
  "clear",
  "lock",
  "unlock",
  "slowmode",
  "addrole",
  "removerole",
  "nick",
]);

function actionKeyIsBlocked(key: string): boolean {
  const now = Date.now();
  for (const [cachedKey, expiresAt] of recentActionKeys) {
    if (expiresAt <= now) recentActionKeys.delete(cachedKey);
  }
  return activeActionKeys.has(key) || (recentActionKeys.get(key) ?? 0) > now;
}

function releaseActionKey(key: string, remember = true): void {
  activeActionKeys.delete(key);
  if (remember) recentActionKeys.set(key, Date.now() + 5_000);
}

type PreparedCommand = {
  targetUser?: User;
  targetMember?: GuildMember;
  targetRole?: Role;
  targetId?: string;
  targetTag?: string;
  channel?: ModerationTextChannel;
  warning?: WarningRecord;
  durationSeconds?: number;
};

type CommandResult = {
  title: string;
  description: string;
  color?: number;
  targetId?: string | null;
  targetTag?: string | null;
  duration?: string | null;
  details?: string | null;
};

const CONFIRM_REQUIRED = new Set([
  "ban",
  "kick",
  "timeout",
  "clearwarns",
  "deletewarn",
  "clear",
]);

function resultEmbed(result: CommandResult) {
  return new EmbedBuilder()
    .setColor(result.color ?? 0x23866d)
    .setTitle(result.title)
    .setDescription(result.description)
    .setFooter({ text: "بوت الإدارة الاحترافي" })
    .setTimestamp();
}

function errorEmbed(message: string) {
  return new EmbedBuilder()
    .setColor(0xc84848)
    .setTitle("تعذّر تنفيذ الأمر")
    .setDescription(message)
    .setFooter({ text: "لم يُنفّذ الإجراء عند فشل التحقق" })
    .setTimestamp();
}

function shortError(error: unknown): string {
  if (error instanceof ModerationError) return error.message;
  return "رفض Discord العملية أو حدث خطأ تقني. لم يُنفّذ الإجراء.";
}

function commandCategory(commandName: string): string {
  return COMMAND_BY_NAME.get(commandName)?.category ?? "sanctions";
}

function auditEntry(
  interaction: ChatInputCommandInteraction,
  canonicalName: string,
  settings: GuildSettings,
  prepared: PreparedCommand | undefined,
  success: boolean,
  details: string,
  duration?: string | null,
): AuditEntry {
  const guild = interaction.guild!;
  const reason = interaction.options.getString("reason")?.trim() || null;
  const optionUser = interaction.options.getUser("target");
  const optionRole = interaction.options.getRole("role");
  const optionChannel = interaction.options.getChannel("channel");
  const optionUserId = interaction.options.getString("user_id");
  const optionTarget =
    optionUser ??
    (optionRole ? { id: optionRole.id, tag: optionRole.name } : null) ??
    (optionChannel
      ? {
          id: optionChannel.id,
          tag: optionChannel.id,
        }
      : null);
  return {
    guildId: guild.id,
    actorId: interaction.user.id,
    actorTag: interaction.user.tag,
    targetId:
      prepared?.targetId ??
      prepared?.targetMember?.id ??
      prepared?.targetUser?.id ??
      optionTarget?.id ??
      optionUserId ??
      (["serverinfo"].includes(canonicalName) ? guild.id : null),
    targetTag:
      prepared?.targetTag ??
      prepared?.targetMember?.user.tag ??
      prepared?.targetUser?.tag ??
      optionTarget?.tag ??
      optionUserId ??
      null,
    commandName: interaction.commandName,
    category: commandCategory(canonicalName),
    reason,
    duration: duration ?? null,
    success,
    details: details.slice(0, 900),
  };
}

async function recordFailure(
  interaction: ChatInputCommandInteraction,
  canonicalName: string,
  settings: GuildSettings,
  prepared: PreparedCommand | undefined,
  message: string,
): Promise<void> {
  if (!interaction.guild) return;
  try {
    await recordAudit(
      interaction.guild,
      settings,
      auditEntry(interaction, canonicalName, settings, prepared, false, message),
    );
  } catch (error) {
    logger.error(
      { err: error, guildId: interaction.guild.id, commandName: interaction.commandName },
      "Could not save failed moderation attempt",
    );
  }
}

function getDuration(
  interaction: ChatInputCommandInteraction,
  settings: GuildSettings,
): number {
  const duration =
    interaction.options.getInteger("duration") ?? settings.defaultTimeoutSeconds;
  if (!Number.isInteger(duration) || duration < 1 || duration > MAX_TIMEOUT_SECONDS) {
    throw new ModerationError("مدة الإسكات يجب أن تكون بين ثانية و28 يوماً.");
  }
  return duration;
}

function resolveTextChannel(
  interaction: ChatInputCommandInteraction,
): ModerationTextChannel {
  const guild = interaction.guild!;
  const selected = interaction.options.getChannel("channel");
  const channelId = selected?.id ?? interaction.channelId;
  const candidate: GuildBasedChannel | null =
    guild.channels.cache.get(channelId) ?? null;
  if (
    !candidate ||
    !candidate.isTextBased() ||
    !("permissionOverwrites" in candidate)
  ) {
    throw new ModerationError("اختر روم محادثة نصياً صالحاً.");
  }
  return candidate as ModerationTextChannel;
}

async function assertChannelPermission(
  guild: Guild,
  channel: ModerationTextChannel,
  permission: keyof typeof PermissionsBitField.Flags,
  extraPermissions: Array<keyof typeof PermissionsBitField.Flags> = [],
): Promise<void> {
  const botMember =
    guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!botMember) {
    throw new ModerationError("تعذّر التحقق من صلاحيات البوت.");
  }
  const permissions = channel.permissionsFor(botMember);
  const required = [permission, ...extraPermissions];
  if (!permissions || required.some((name) => !permissions.has(PermissionsBitField.Flags[name]))) {
    throw new ModerationError(
      `البوت لا يملك الصلاحية المطلوبة في الروم: ${permission}.`,
    );
  }
}

async function prepareCommand(
  interaction: ChatInputCommandInteraction,
  canonicalName: string,
  actor: GuildMember,
  settings: GuildSettings,
): Promise<PreparedCommand> {
  const guild = interaction.guild;
  if (!guild) throw new ModerationError("يجب استخدام الأمر داخل السيرفر.");
  const prepared: PreparedCommand = {};
  const user = interaction.options.getUser("target");
  if (user) {
    prepared.targetUser = user;
    prepared.targetId = user.id;
    prepared.targetTag = user.tag;
    prepared.targetMember = await guild.members.fetch(user.id).catch(() => undefined);
  }

  switch (canonicalName) {
    case "ban": {
      if (!prepared.targetUser) throw new ModerationError("حدد العضو المطلوب حظره.");
      if (prepared.targetUser.id === guild.ownerId) {
        throw new ModerationError("لا يمكن تنفيذ عقوبة على مالك السيرفر.");
      }
      if (prepared.targetMember) {
        assertTargetBelowActor(actor, prepared.targetMember, guild, settings);
        await assertBotCanManageMember(guild, prepared.targetMember);
      } else if (actor.id !== guild.ownerId) {
        throw new ModerationError(
          "حظر مستخدم غير موجود في السيرفر متاح لمالك السيرفر فقط.",
        );
      }
      await requireBotPermission(guild, "BanMembers");
      break;
    }
    case "unban": {
      const userId = interaction.options.getString("user_id", true).trim();
      if (!/^\d{17,20}$/.test(userId)) {
        throw new ModerationError("أدخل معرّف Discord صالحاً للمستخدم.");
      }
      prepared.targetId = userId;
      prepared.targetTag = userId;
      await requireBotPermission(guild, "BanMembers");
      break;
    }
    case "kick":
    case "timeout":
    case "untimeout":
    case "warn":
    case "clearwarns":
    case "nick":
    case "addrole":
    case "removerole": {
      if (!prepared.targetMember) {
        throw new ModerationError("العضو المستهدف غير موجود في هذا السيرفر.");
      }
      assertTargetBelowActor(actor, prepared.targetMember, guild, settings);
      if (["kick", "timeout", "untimeout"].includes(canonicalName)) {
        await assertBotCanManageMember(guild, prepared.targetMember);
        const permission =
          canonicalName === "kick"
            ? "KickMembers"
            : canonicalName === "timeout" || canonicalName === "untimeout"
              ? "ModerateMembers"
              : "ManageGuild";
        if (permission !== "ManageGuild") await requireBotPermission(guild, permission);
      }
      if (canonicalName === "nick") {
        await assertBotCanManageMember(guild, prepared.targetMember);
        await requireBotPermission(guild, "ManageNicknames");
      }
      if (canonicalName === "addrole" || canonicalName === "removerole") {
        const selectedRole = interaction.options.getRole("role", true);
        const role = guild.roles.cache.get(selectedRole.id);
        if (!role) throw new ModerationError("تعذر العثور على الرتبة في هذا السيرفر.");
        prepared.targetRole = role;
        assertRoleBelowActor(actor, role, guild);
        await assertBotCanManageRole(guild, role);
        await requireBotPermission(guild, "ManageRoles");
      }
      break;
    }
    case "warnings": {
      if (!prepared.targetMember) {
        throw new ModerationError("العضو المستهدف غير موجود في هذا السيرفر.");
      }
      break;
    }
    case "deletewarn": {
      const warningId = interaction.options.getInteger("warning_id", true);
      const warning = await getWarning(guild.id, warningId);
      if (!warning) throw new ModerationError("لم يُعثر على هذا التحذير في السيرفر.");
      prepared.warning = warning;
      prepared.targetId = warning.userId;
      prepared.targetTag = warning.userId;
      const targetMember = await guild.members.fetch(warning.userId).catch(() => undefined);
      prepared.targetMember = targetMember;
      if (targetMember) {
        assertTargetBelowActor(actor, targetMember, guild, settings);
      } else if (actor.id !== guild.ownerId) {
        throw new ModerationError(
          "إدارة تحذير عضو غادر السيرفر متاحة لمالك السيرفر فقط.",
        );
      }
      break;
    }
    case "clear":
    case "lock":
    case "unlock":
    case "slowmode": {
      const channel = resolveTextChannel(interaction);
      prepared.channel = channel;
      prepared.targetId = channel.id;
      prepared.targetTag = `#${"name" in channel ? channel.name : "channel"}`;
      const permission =
        canonicalName === "clear" ? "ManageMessages" : "ManageChannels";
      await assertChannelPermission(
        guild,
        channel,
        permission,
        canonicalName === "clear" ? ["ViewChannel", "ReadMessageHistory"] : ["ViewChannel"],
      );
      break;
    }
    case "roleinfo": {
      const selectedRole = interaction.options.getRole("role", true);
      const role = guild.roles.cache.get(selectedRole.id);
      if (!role) throw new ModerationError("تعذر العثور على الرتبة في هذا السيرفر.");
      prepared.targetRole = role;
      prepared.targetId = role.id;
      prepared.targetTag = role.name;
      break;
    }
    case "userinfo":
    case "avatar": {
      if (!prepared.targetUser) {
        prepared.targetUser = interaction.user;
        prepared.targetId = interaction.user.id;
        prepared.targetTag = interaction.user.tag;
        prepared.targetMember = actor;
      }
      break;
    }
    case "serverinfo":
    case "setup":
      break;
    default:
      throw new ModerationError("هذا الأمر غير معروف.");
  }

  if (canonicalName === "timeout") {
    prepared.durationSeconds = getDuration(interaction, settings);
  }
  return prepared;
}

function ensureReason(
  interaction: ChatInputCommandInteraction,
  commandName: string,
  settings: GuildSettings,
): string {
  const reason = interaction.options.getString("reason")?.trim() || "";
  if (settings.reasonRequiredCommands.includes(commandName) && !reason) {
    throw new ModerationError("هذا الأمر يتطلب كتابة سبب قبل التنفيذ.");
  }
  return reason || "لم يُذكر سبب";
}

async function performCommand(
  interaction: ChatInputCommandInteraction,
  canonicalName: string,
  prepared: PreparedCommand,
  settings: GuildSettings,
  reason: string,
): Promise<CommandResult> {
  const guild = interaction.guild!;
  const target = prepared.targetMember;
  const user = prepared.targetUser;
  const role = prepared.targetRole;
  const channel = prepared.channel;

  switch (canonicalName) {
    case "ban":
      await guild.members.ban(user!, { reason: reason.slice(0, 512) });
      return {
        title: "تم حظر العضو",
        description: `تم حظر ${user} من السيرفر.`,
        targetId: user!.id,
        targetTag: user!.tag,
      };
    case "unban":
      await guild.bans.remove(prepared.targetId!, reason.slice(0, 512));
      return {
        title: "تم فك الحظر",
        description: `تم فك الحظر عن المستخدم \`${prepared.targetId}\`.`,
        targetId: prepared.targetId,
        targetTag: prepared.targetTag,
      };
    case "kick":
      await target!.kick(reason.slice(0, 512));
      return {
        title: "تم طرد العضو",
        description: `تم طرد ${user} من السيرفر.`,
        targetId: target!.id,
        targetTag: target!.user.tag,
      };
    case "timeout": {
      const durationSeconds = prepared.durationSeconds ?? settings.defaultTimeoutSeconds;
      await target!.timeout(durationSeconds * 1000, reason.slice(0, 512));
      return {
        title: "تم إسكات العضو",
        description: `تم إسكات ${user} لمدة ${durationSeconds} ثانية.`,
        targetId: target!.id,
        targetTag: target!.user.tag,
        duration: `${durationSeconds} ثانية`,
      };
    }
    case "untimeout":
      await target!.timeout(null, reason.slice(0, 512));
      return {
        title: "تمت إزالة الإسكات",
        description: `تمت إزالة الإسكات عن ${user}.`,
        targetId: target!.id,
        targetTag: target!.user.tag,
      };
    case "warn": {
      const warning = await addWarning({
        guildId: guild.id,
        userId: target!.id,
        moderatorId: interaction.user.id,
        moderatorTag: interaction.user.tag,
        reason,
      });
      const warnings = await listWarnings(guild.id, target!.id);
      let autoDetails = "";
      const rule = settings.autoWarnRule;
      if (rule.enabled && warnings.length === rule.threshold) {
        try {
          await assertBotCanManageMember(guild, target!);
          if (rule.action === "timeout") {
            await requireBotPermission(guild, "ModerateMembers");
            await target!.timeout(
              rule.durationSeconds * 1000,
              `تلقائي بعد ${rule.threshold} تحذيرات`,
            );
          } else if (rule.action === "kick") {
            await requireBotPermission(guild, "KickMembers");
            await target!.kick(`تلقائي بعد ${rule.threshold} تحذيرات`);
          } else {
            await requireBotPermission(guild, "BanMembers");
            await guild.members.ban(target!.id, {
              reason: `تلقائي بعد ${rule.threshold} تحذيرات`,
            });
          }
          autoDetails = `\nتم تطبيق العقوبة التلقائية: ${rule.action}.`;
        } catch (error) {
          autoDetails = `\nتعذر تطبيق العقوبة التلقائية: ${shortError(error)}`;
        }
      }
      return {
        title: "تم تسجيل التحذير",
        description: `تم تحذير ${user}. رقم التحذير: **${warning.id}**. إجمالي التحذيرات: **${warnings.length}**.${autoDetails}`,
        targetId: target!.id,
        targetTag: target!.user.tag,
        details: `رقم التحذير ${warning.id}.${autoDetails}`,
      };
    }
    case "warnings": {
      const warnings = await listWarnings(guild.id, target!.id);
      const embed = resultEmbed({
        title: `تحذيرات ${target!.user.tag}`,
        description: warnings.length
          ? warnings
              .slice(0, 20)
              .map(
                (warning) =>
                  `**#${warning.id}** · ${warning.createdAt.toLocaleString("ar")}\nالمشرف: <@${warning.moderatorId}>\nالسبب: ${warning.reason}`,
              )
              .join("\n\n")
          : "لا توجد تحذيرات مسجلة لهذا العضو.",
        color: 0x425f7a,
      });
      embed.setFooter({ text: `عرض ${Math.min(warnings.length, 20)} من ${warnings.length}` });
      return {
        title: `تحذيرات ${target!.user.tag}`,
        description: embed.data.description ?? "لا توجد تحذيرات.",
        color: 0x425f7a,
        targetId: target!.id,
        targetTag: target!.user.tag,
      };
    }
    case "clearwarns": {
      const deleted = await clearWarnings(guild.id, target!.id);
      return {
        title: "تم مسح التحذيرات",
        description: `تم حذف **${deleted.length}** تحذيراً عن ${user}.`,
        targetId: target!.id,
        targetTag: target!.user.tag,
        details: `حُذف ${deleted.length} تحذير`,
      };
    }
    case "deletewarn": {
      const warning = await deleteWarning(guild.id, prepared.warning!.id);
      if (!warning) throw new ModerationError("تعذر حذف التحذير؛ ربما حُذف مسبقاً.");
      return {
        title: "تم حذف التحذير",
        description: `تم حذف التحذير **#${warning.id}**.`,
        targetId: warning.userId,
        targetTag: warning.userId,
      };
    }
    case "clear": {
      const count = interaction.options.getInteger("count", true);
      const deleted = await channel!.bulkDelete(count, true);
      return {
        title: "تم حذف الرسائل",
        description: `حُذفت **${deleted.size}** رسالة من <#${channel!.id}>. الرسائل الأقدم من 14 يوماً لا يمكن حذفها جماعياً في Discord.`,
        targetId: channel!.id,
        targetTag: prepared.targetTag,
        details: `العدد المطلوب ${count}؛ المحذوف ${deleted.size}`,
      };
    }
    case "lock":
    case "unlock": {
      const locked = canonicalName === "lock";
      await channel!.permissionOverwrites.edit(
        guild.roles.everyone.id,
        { SendMessages: locked ? false : null },
        { reason: reason.slice(0, 512) },
      );
      return {
        title: locked ? "تم قفل الروم" : "تم فتح الروم",
        description: `تم ${locked ? "قفل" : "فتح"} <#${channel!.id}>.`,
        targetId: channel!.id,
        targetTag: prepared.targetTag,
      };
    }
    case "slowmode": {
      const seconds = interaction.options.getInteger("seconds", true);
      await channel!.setRateLimitPerUser(seconds, reason.slice(0, 512));
      return {
        title: "تم تحديث الوضع البطيء",
        description: seconds
          ? `تم ضبط الوضع البطيء في <#${channel!.id}> على ${seconds} ثانية.`
          : `تم إيقاف الوضع البطيء في <#${channel!.id}>.`,
        targetId: channel!.id,
        targetTag: prepared.targetTag,
        duration: `${seconds} ثانية`,
      };
    }
    case "addrole":
      await target!.roles.add(role!, reason.slice(0, 512));
      return {
        title: "تمت إضافة الرتبة",
        description: `أُضيفت الرتبة **${role!.name}** إلى ${user}.`,
        targetId: target!.id,
        targetTag: target!.user.tag,
      };
    case "removerole":
      if (!target!.roles.cache.has(role!.id)) {
        throw new ModerationError("العضو لا يمتلك هذه الرتبة.");
      }
      await target!.roles.remove(role!, reason.slice(0, 512));
      return {
        title: "تمت إزالة الرتبة",
        description: `أُزيلت الرتبة **${role!.name}** من ${user}.`,
        targetId: target!.id,
        targetTag: target!.user.tag,
      };
    case "roleinfo":
      return {
        title: `معلومات الرتبة: ${role!.name}`,
        description: `المعرّف: \`${role!.id}\`\nالترتيب: ${role!.position}\nعدد الأعضاء في الذاكرة: ${role!.members.size}\nلون الرتبة: ${role!.hexColor}\nقابلة للذكر: ${role!.mentionable ? "نعم" : "لا"}`,
        color: role!.color || 0x425f7a,
        targetId: role!.id,
        targetTag: role!.name,
      };
    case "userinfo": {
      const member = prepared.targetMember;
      const roles = member
        ? member.roles.cache
            .filter((entry) => entry.id !== guild.id)
            .sort((left, right) => right.position - left.position)
            .map((entry) => `<@&${entry.id}>`)
            .slice(0, 15)
        : [];
      return {
        title: `معلومات العضو: ${user!.tag}`,
        description: `المعرّف: \`${user!.id}\`\nانضم إلى السيرفر: ${member?.joinedAt?.toLocaleDateString("ar") ?? "غير متاح"}\nتاريخ إنشاء الحساب: ${user!.createdAt.toLocaleDateString("ar")}\nاللقب: ${member?.nickname ?? "لا يوجد"}\nأعلى رتبة: ${member?.roles.highest.name ?? "غير متاح"}\nالرتب: ${roles.join("، ") || "لا توجد رتب إضافية"}`,
        color: 0x425f7a,
        targetId: user!.id,
        targetTag: user!.tag,
      };
    }
    case "serverinfo":
      return {
        title: `معلومات السيرفر: ${guild.name}`,
        description: `المعرّف: \`${guild.id}\`\nالمالك: <@${guild.ownerId}>\nالأعضاء: ${guild.memberCount}\nالقنوات: ${guild.channels.cache.size}\nالرتب: ${guild.roles.cache.size}\nتاريخ الإنشاء: ${guild.createdAt.toLocaleDateString("ar")}`,
        color: 0x425f7a,
        targetId: guild.id,
        targetTag: guild.name,
      };
    case "avatar":
      return {
        title: `الصورة الشخصية: ${user!.tag}`,
        description: `[فتح الصورة بالحجم الكامل](${user!.displayAvatarURL({ size: 1024 })})`,
        color: 0x425f7a,
        targetId: user!.id,
        targetTag: user!.tag,
        details: `الصورة: ${user!.displayAvatarURL({ size: 1024 })}`,
      };
    case "nick": {
      const nickname = interaction.options.getString("nickname");
      await target!.setNickname(nickname || null, reason.slice(0, 512));
      return {
        title: nickname ? "تم تغيير اللقب" : "تمت إزالة اللقب",
        description: nickname
          ? `تم تغيير لقب ${user} إلى **${nickname}**.`
          : `تمت إزالة اللقب المخصص عن ${user}.`,
        targetId: target!.id,
        targetTag: target!.user.tag,
      };
    }
    default:
      throw new ModerationError("هذا الأمر غير معروف.");
  }
}

async function executeAuthorizedCommand(
  interaction: ChatInputCommandInteraction,
  canonicalName: string,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.deleteReply().catch(() => undefined);
    return;
  }
  const settings = await getGuildSettings(guild.id);
  const actor = await fetchActorMember(guild, interaction.user.id).catch(
    () => null,
  );
  if (!actor || !canUseCommand(canonicalName, actor, guild, settings)) {
    await interaction.deleteReply().catch(() => undefined);
    return;
  }
  if (settings.disabledCommands.includes(canonicalName)) {
    await interaction.editReply({
      embeds: [errorEmbed("هذا الأمر معطّل حالياً من لوحة /setup.")],
    });
    return;
  }

  let prepared: PreparedCommand | undefined;
  let reason: string;
  try {
    reason = ensureReason(interaction, canonicalName, settings);
    prepared = await prepareCommand(interaction, canonicalName, actor, settings);
  } catch (error) {
    const message = shortError(error);
    await recordFailure(interaction, canonicalName, settings, prepared, message);
    await interaction.editReply({ embeds: [errorEmbed(message)], components: [] });
    return;
  }

  let logId: number | undefined;
  let completed = false;
  try {
    const startingEntry = auditEntry(
      interaction,
      canonicalName,
      settings,
      prepared,
      false,
      "قيد التنفيذ",
      prepared.durationSeconds ? `${prepared.durationSeconds} ثانية` : null,
    );
    // If durable audit storage is unavailable, do not execute an admin action.
    logId = await startModerationLog(startingEntry);
    const result = await performCommand(
      interaction,
      canonicalName,
      prepared,
      settings,
      reason,
    );
    completed = true;
    const resultEntry: AuditEntry = {
      ...auditEntry(
        interaction,
        canonicalName,
        settings,
        { ...prepared, targetId: result.targetId ?? prepared.targetId, targetTag: result.targetTag ?? prepared.targetTag },
        true,
        result.details ?? result.description,
        result.duration,
      ),
    };
    await finishAudit(guild, settings, resultEntry, logId);
    const embed = resultEmbed(result);
    if (canonicalName === "warnings" && prepared.targetMember) {
      const warningList = await listWarnings(guild.id, prepared.targetMember.id);
      embed.setDescription(
        warningList.length
          ? warningList
              .slice(0, 20)
              .map(
                (warning) =>
                  `**#${warning.id}** · ${warning.createdAt.toLocaleString("ar")}\nالمشرف: <@${warning.moderatorId}>\nالسبب: ${warning.reason}`,
              )
              .join("\n\n")
          : "لا توجد تحذيرات مسجلة لهذا العضو.",
      );
      embed.setFooter({ text: `عرض ${Math.min(warningList.length, 20)} من ${warningList.length}` });
    }
    if (canonicalName === "avatar" && prepared.targetUser) {
      embed.setImage(prepared.targetUser.displayAvatarURL({ size: 1024 }));
    }
    await interaction.editReply({ embeds: [embed], components: [] });
  } catch (error) {
    const message = shortError(error);
    if (logId !== undefined) {
      try {
        await finishAudit(
          guild,
          settings,
          auditEntry(
            interaction,
            canonicalName,
            settings,
            prepared,
            completed,
            completed
              ? "تم تنفيذ الإجراء لكن تعذر تأكيد السجل"
              : message,
            prepared.durationSeconds ? `${prepared.durationSeconds} ثانية` : null,
          ),
          logId,
        );
      } catch (auditError) {
        logger.error(
          { err: auditError, guildId: guild.id, commandName: interaction.commandName },
          "Could not finish moderation audit record",
        );
      }
    } else {
      await recordFailure(interaction, canonicalName, settings, prepared, message);
    }
    logger.error(
      { err: error, guildId: guild.id, commandName: interaction.commandName },
      "Moderation command failed",
    );
    const safeMessage = completed
      ? "تم تنفيذ الإجراء، لكن تعذّر تأكيد حفظ سجل النتيجة. تحقق من روم السجلات قبل إعادة المحاولة."
      : message;
    await interaction.editReply({
      embeds: [errorEmbed(safeMessage)],
      components: [],
    }).catch(() => undefined);
  }
}

function confirmationMessage(commandName: string) {
  const names: Record<string, string> = {
    ban: "حظر العضو",
    kick: "طرد العضو",
    timeout: "إسكات العضو",
    clearwarns: "مسح تحذيرات العضو",
    deletewarn: "حذف التحذير",
    clear: "حذف الرسائل",
  };
  return names[commandName] ?? commandName;
}

async function askForConfirmation(
  interaction: ChatInputCommandInteraction,
  canonicalName: string,
  actionKey: string,
): Promise<void> {
  const token = crypto.randomUUID();
  confirmations.set(token, {
    actorId: interaction.user.id,
    guildId: interaction.guildId!,
    expiresAt: Date.now() + CONFIRMATION_TTL_MS,
    interaction,
    commandName: canonicalName,
    actionKey,
  });
  setTimeout(() => {
    confirmations.delete(token);
    activeActionKeys.delete(actionKey);
  }, CONFIRMATION_TTL_MS).unref();
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`mod-confirm:yes:${token}`)
      .setLabel("تأكيد التنفيذ")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`mod-confirm:no:${token}`)
      .setLabel("إلغاء")
      .setStyle(ButtonStyle.Secondary),
  );
  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xd79a43)
        .setTitle("تأكيد الإجراء")
        .setDescription(
          `هل تريد المتابعة في **${confirmationMessage(canonicalName)}**؟ ستُعاد مراجعة الصلاحيات وترتيب الرتب قبل التنفيذ.`,
        )
        .setFooter({ text: "ينتهي التأكيد تلقائياً خلال 90 ثانية" }),
    ],
    components: [row],
  });
}

export async function handleModerationCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply({ ephemeral: EPHEMERAL });
  const guild = interaction.guild;
  if (!guild) {
    await interaction.deleteReply().catch(() => undefined);
    return;
  }
  let settings: GuildSettings;
  try {
    settings = await getGuildSettings(guild.id);
  } catch (error) {
    logger.error({ err: error, guildId: guild.id }, "Could not load guild settings");
    await interaction.editReply({
      embeds: [errorEmbed("تعذر تحميل إعدادات هذا السيرفر؛ لم يُنفذ الأمر.")],
    });
    return;
  }
  const invokedName = interaction.commandName;
  const canonicalName = settings.aliases[invokedName] ?? invokedName;
  if (canonicalName === "setup") {
    const { showSetupPanel } = await import("./setup");
    await showSetupPanel(interaction);
    return;
  }
  if (!COMMAND_BY_NAME.has(canonicalName)) {
    await interaction.deleteReply().catch(() => undefined);
    return;
  }
  const actor = await fetchActorMember(guild, interaction.user.id).catch(
    () => null,
  );
  if (!actor || !canUseCommand(canonicalName, actor, guild, settings)) {
    // Discord requires slash-command acknowledgement. Delete the ephemeral
    // deferred response so unauthorized users receive no permission details.
    await interaction.deleteReply().catch(() => undefined);
    return;
  }
  if (settings.disabledCommands.includes(canonicalName)) {
    await interaction.editReply({
      embeds: [errorEmbed("هذا الأمر معطّل حالياً من لوحة /setup.")],
    });
    return;
  }

  const actionKey = MUTATING_COMMANDS.has(canonicalName)
    ? `${guild.id}:${interaction.user.id}:${canonicalName}:${interaction.options.getUser("target")?.id ?? interaction.options.getRole("role")?.id ?? interaction.options.getString("user_id") ?? interaction.options.getInteger("warning_id") ?? interaction.options.getChannel("channel")?.id ?? interaction.channelId}`
    : null;
  if (actionKey && actionKeyIsBlocked(actionKey)) {
    await interaction.editReply({
      embeds: [errorEmbed("يوجد طلب مطابق قيد التنفيذ أو بانتظار التأكيد.")],
    });
    return;
  }

  if (CONFIRM_REQUIRED.has(canonicalName)) {
    try {
      ensureReason(interaction, canonicalName, settings);
      await prepareCommand(interaction, canonicalName, actor, settings);
    } catch (error) {
      const message = shortError(error);
      await recordFailure(interaction, canonicalName, settings, undefined, message);
      await interaction.editReply({ embeds: [errorEmbed(message)] });
      return;
    }
    if (actionKey) activeActionKeys.add(actionKey);
    try {
      await askForConfirmation(interaction, canonicalName, actionKey ?? "");
    } catch (error) {
      if (actionKey) releaseActionKey(actionKey, false);
      throw error;
    }
    return;
  }

  if (actionKey) activeActionKeys.add(actionKey);
  try {
    await executeAuthorizedCommand(interaction, canonicalName);
  } finally {
    if (actionKey) releaseActionKey(actionKey);
  }
}

async function reauthorizeAndExecute(
  interaction: ChatInputCommandInteraction,
  canonicalName: string,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.deleteReply().catch(() => undefined);
    return;
  }
  const settings = await getGuildSettings(guild.id);
  const actor = await fetchActorMember(guild, interaction.user.id).catch(
    () => null,
  );
  if (
    !actor ||
    !canUseCommand(canonicalName, actor, guild, settings) ||
    settings.disabledCommands.includes(canonicalName)
  ) {
    await interaction.deleteReply().catch(() => undefined);
    return;
  }
  await executeAuthorizedCommand(interaction, canonicalName);
}

export async function handleModerationComponent(
  interaction: ButtonInteraction,
): Promise<boolean> {
  if (!interaction.customId.startsWith("mod-confirm:")) return false;
  const [, decision, token] = interaction.customId.split(":");
  const pending = confirmations.get(token);
  if (!pending) {
    await interaction.update({
      embeds: [errorEmbed("انتهت صلاحية التأكيد. أعد إرسال الأمر إذا لزم الأمر.")],
      components: [],
    });
    return true;
  }
  if (
    interaction.user.id !== pending.actorId ||
    interaction.guildId !== pending.guildId
  ) {
    await interaction.reply({
      content: "هذا التأكيد غير متاح لك.",
      ephemeral: true,
    });
    return true;
  }
  if (Date.now() > pending.expiresAt) {
    confirmations.delete(token);
    releaseActionKey(pending.actionKey, false);
    await interaction.update({
      embeds: [errorEmbed("انتهت صلاحية التأكيد. أعد إرسال الأمر إذا لزم الأمر.")],
      components: [],
    });
    return true;
  }
  confirmations.delete(token);
  if (decision === "no") {
    releaseActionKey(pending.actionKey, false);
    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0x596273)
          .setTitle("أُلغي الإجراء")
          .setDescription("لم يُنفّذ أي تغيير."),
      ],
      components: [],
    });
    return true;
  }
  await interaction.deferUpdate();
  try {
    await reauthorizeAndExecute(pending.interaction, pending.commandName);
  } catch (error) {
    logger.error(
      {
        err: error,
        guildId: pending.guildId,
        commandName: pending.commandName,
      },
      "Could not confirm moderation action",
    );
    await pending.interaction
      .editReply({ embeds: [errorEmbed(shortError(error))], components: [] })
      .catch(() => undefined);
  } finally {
    releaseActionKey(pending.actionKey);
  }
  return true;
}
