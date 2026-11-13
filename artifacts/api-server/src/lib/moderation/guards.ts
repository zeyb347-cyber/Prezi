import {
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type Role,
} from "discord.js";
import type { GuildSettings } from "@workspace/db";

export class ModerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModerationError";
  }
}

export function canUseCommand(
  commandName: string,
  member: GuildMember,
  guild: Guild,
  settings: GuildSettings,
): boolean {
  if (member.id === guild.ownerId) return true;
  const allowedRoleIds = settings.commandPermissions[commandName] ?? [];
  return allowedRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

export function canManageSetup(
  member: GuildMember,
  guild: Guild,
  settings: GuildSettings,
): boolean {
  return (
    member.id === guild.ownerId ||
    settings.setupRoleIds.some((roleId) => member.roles.cache.has(roleId))
  );
}

export async function requireBotPermission(
  guild: Guild,
  permission: keyof typeof PermissionFlagsBits,
): Promise<GuildMember> {
  const botMember =
    guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!botMember) {
    throw new ModerationError("تعذر التحقق من صلاحيات البوت داخل هذا السيرفر.");
  }
  const permissionBit = PermissionFlagsBits[permission];
  if (!botMember.permissions.has(permissionBit)) {
    throw new ModerationError(
      `البوت لا يملك الصلاحية المطلوبة في Discord: ${permission}.`,
    );
  }
  return botMember;
}

export function assertTargetBelowActor(
  actor: GuildMember,
  target: GuildMember,
  guild: Guild,
  settings: GuildSettings,
): void {
  if (target.id === guild.ownerId) {
    throw new ModerationError("لا يمكن تنفيذ عقوبة أو تعديل على مالك السيرفر.");
  }
  if (
    settings.protectionEnabled &&
    settings.protectEqualOrHigher &&
    actor.id !== guild.ownerId &&
    actor.roles.highest.comparePositionTo(target.roles.highest) <= 0
  ) {
    throw new ModerationError(
      "لا يمكن تنفيذ هذا الإجراء على عضو رتبته مساوية لرتبتك أو أعلى.",
    );
  }
}

export async function assertBotCanManageMember(
  guild: Guild,
  target: GuildMember,
): Promise<GuildMember> {
  const botMember =
    guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!botMember) {
    throw new ModerationError("تعذر التحقق من رتبة البوت.");
  }
  if (
    target.id === guild.ownerId ||
    botMember.roles.highest.comparePositionTo(target.roles.highest) <= 0
  ) {
    throw new ModerationError(
      "رتبة البوت يجب أن تكون أعلى من رتبة العضو المستهدف.",
    );
  }
  return botMember;
}

export async function assertBotCanManageRole(
  guild: Guild,
  role: Role,
): Promise<void> {
  const botMember =
    guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!botMember) {
    throw new ModerationError("تعذر التحقق من رتبة البوت.");
  }
  if (
    role.managed ||
    role.id === guild.id ||
    botMember.roles.highest.comparePositionTo(role) <= 0
  ) {
    throw new ModerationError(
      "رتبة البوت يجب أن تكون أعلى من الرتبة المطلوب تعديلها.",
    );
  }
}

export function assertRoleBelowActor(
  actor: GuildMember,
  role: Role,
  guild: Guild,
): void {
  if (
    actor.id !== guild.ownerId &&
    actor.roles.highest.comparePositionTo(role) <= 0
  ) {
    throw new ModerationError(
      "لا يمكنك إعطاء أو إزالة رتبة مساوية لرتبتك أو أعلى.",
    );
  }
  if (role.managed || role.id === guild.id) {
    throw new ModerationError("لا يمكن تعديل هذه الرتبة.");
  }
}

export async function fetchActorMember(
  guild: Guild,
  userId: string,
): Promise<GuildMember> {
  try {
    return await guild.members.fetch(userId);
  } catch {
    throw new ModerationError("تعذر العثور على رتبتك الحالية في السيرفر.");
  }
}
