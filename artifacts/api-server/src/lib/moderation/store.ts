import { and, desc, eq } from "drizzle-orm";
import {
  DEFAULT_GUILD_SETTINGS,
  db,
  guildSettingsTable,
  moderationLogsTable,
  warningsTable,
  type GuildSettings,
} from "@workspace/db";

const settingsCache = new Map<string, GuildSettings>();

function normalizeSettings(value: Partial<GuildSettings> | null | undefined): GuildSettings {
  return {
    ...DEFAULT_GUILD_SETTINGS,
    ...value,
    commandPermissions: value?.commandPermissions ?? {},
    aliases: value?.aliases ?? {},
    setupRoleIds: value?.setupRoleIds ?? [],
    logTypes: value?.logTypes ?? DEFAULT_GUILD_SETTINGS.logTypes,
    reasonRequiredCommands: value?.reasonRequiredCommands ?? [],
    disabledCommands: value?.disabledCommands ?? [],
    autoWarnRule: {
      ...DEFAULT_GUILD_SETTINGS.autoWarnRule,
      ...value?.autoWarnRule,
    },
  };
}

export async function getGuildSettings(guildId: string): Promise<GuildSettings> {
  const cached = settingsCache.get(guildId);
  if (cached) return structuredClone(cached);

  const [row] = await db
    .select({ settings: guildSettingsTable.settings })
    .from(guildSettingsTable)
    .where(eq(guildSettingsTable.guildId, guildId))
    .limit(1);

  if (row) {
    const settings = normalizeSettings(row.settings);
    settingsCache.set(guildId, settings);
    return structuredClone(settings);
  }

  const defaults = structuredClone(DEFAULT_GUILD_SETTINGS);
  await db
    .insert(guildSettingsTable)
    .values({ guildId, settings: defaults })
    .onConflictDoNothing();
  settingsCache.set(guildId, defaults);
  return structuredClone(defaults);
}

export async function saveGuildSettings(
  guildId: string,
  settings: GuildSettings,
): Promise<GuildSettings> {
  const normalized = normalizeSettings(settings);
  await db
    .insert(guildSettingsTable)
    .values({ guildId, settings: normalized, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: guildSettingsTable.guildId,
      set: { settings: normalized, updatedAt: new Date() },
    });
  settingsCache.set(guildId, normalized);
  return structuredClone(normalized);
}

export async function addModerationLog(entry: {
  guildId: string;
  actorId: string;
  actorTag: string;
  targetId?: string | null;
  targetTag?: string | null;
  commandName: string;
  reason?: string | null;
  duration?: string | null;
  success: boolean;
  details?: string | null;
}) {
  const [row] = await db.insert(moderationLogsTable).values({
    guildId: entry.guildId,
    actorId: entry.actorId,
    actorTag: entry.actorTag,
    targetId: entry.targetId ?? null,
    targetTag: entry.targetTag ?? null,
    commandName: entry.commandName,
    reason: entry.reason ?? null,
    duration: entry.duration ?? null,
    success: entry.success,
    status: entry.success ? "success" : "failure",
    details: entry.details ?? null,
  }).returning({ id: moderationLogsTable.id });
  return row.id;
}

export async function startModerationLog(entry: {
  guildId: string;
  actorId: string;
  actorTag: string;
  targetId?: string | null;
  targetTag?: string | null;
  commandName: string;
  reason?: string | null;
  duration?: string | null;
}): Promise<number> {
  const [row] = await db
    .insert(moderationLogsTable)
    .values({
      guildId: entry.guildId,
      actorId: entry.actorId,
      actorTag: entry.actorTag,
      targetId: entry.targetId ?? null,
      targetTag: entry.targetTag ?? null,
      commandName: entry.commandName,
      reason: entry.reason ?? null,
      duration: entry.duration ?? null,
      success: false,
      status: "pending",
      details: "قيد التنفيذ",
    })
    .returning({ id: moderationLogsTable.id });
  return row.id;
}

export async function updateModerationLog(
  id: number,
  success: boolean,
  details: string | null,
): Promise<void> {
  await db
    .update(moderationLogsTable)
    .set({
      success,
      status: success ? "success" : "failure",
      details,
    })
    .where(eq(moderationLogsTable.id, id));
}

export async function getWarning(guildId: string, warningId: number) {
  const [warning] = await db
    .select()
    .from(warningsTable)
    .where(
      and(
        eq(warningsTable.guildId, guildId),
        eq(warningsTable.id, warningId),
      ),
    )
    .limit(1);
  return warning;
}

export async function addWarning(input: {
  guildId: string;
  userId: string;
  moderatorId: string;
  moderatorTag: string;
  reason: string;
}) {
  const [warning] = await db.insert(warningsTable).values(input).returning();
  return warning;
}

export async function listWarnings(guildId: string, userId: string) {
  return db
    .select()
    .from(warningsTable)
    .where(
      and(
        eq(warningsTable.guildId, guildId),
        eq(warningsTable.userId, userId),
      ),
    )
    .orderBy(desc(warningsTable.createdAt));
}

export async function deleteWarning(guildId: string, warningId: number) {
  const [warning] = await db
    .delete(warningsTable)
    .where(
      and(
        eq(warningsTable.guildId, guildId),
        eq(warningsTable.id, warningId),
      ),
    )
    .returning();
  return warning;
}

export async function clearWarnings(guildId: string, userId: string) {
  return db
    .delete(warningsTable)
    .where(
      and(
        eq(warningsTable.guildId, guildId),
        eq(warningsTable.userId, userId),
      ),
    )
    .returning({ id: warningsTable.id });
}
