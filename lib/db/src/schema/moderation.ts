import {
  boolean,
  index,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export type AutoWarnRule = {
  enabled: boolean;
  threshold: number;
  action: "timeout" | "kick" | "ban";
  durationSeconds: number;
};

export type GuildSettings = {
  commandPermissions: Record<string, string[]>;
  aliases: Record<string, string>;
  setupRoleIds: string[];
  protectionEnabled: boolean;
  protectOwner: boolean;
  protectEqualOrHigher: boolean;
  logChannelId: string | null;
  logTypes: string[];
  reasonRequiredCommands: string[];
  defaultTimeoutSeconds: number;
  disabledCommands: string[];
  autoWarnRule: AutoWarnRule;
};

export const DEFAULT_GUILD_SETTINGS: GuildSettings = {
  commandPermissions: {},
  aliases: {},
  setupRoleIds: [],
  protectionEnabled: true,
  protectOwner: true,
  protectEqualOrHigher: true,
  logChannelId: null,
  logTypes: ["sanctions", "warnings", "roles", "messages", "settings"],
  reasonRequiredCommands: [],
  defaultTimeoutSeconds: 3600,
  disabledCommands: [],
  autoWarnRule: {
    enabled: false,
    threshold: 3,
    action: "timeout",
    durationSeconds: 3600,
  },
};

export const guildSettingsTable = pgTable("guild_settings", {
  guildId: text("guild_id").primaryKey(),
  settings: jsonb("settings").$type<GuildSettings>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const moderationLogsTable = pgTable(
  "moderation_logs",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    actorId: text("actor_id").notNull(),
    actorTag: text("actor_tag").notNull(),
    targetId: text("target_id"),
    targetTag: text("target_tag"),
    commandName: text("command_name").notNull(),
    reason: text("reason"),
    duration: text("duration"),
    success: boolean("success").notNull(),
    status: text("status").notNull().default("pending"),
    details: text("details"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    guildCreatedIndex: index("moderation_logs_guild_created_idx").on(
      table.guildId,
      table.createdAt,
    ),
  }),
);

export const warningsTable = pgTable(
  "moderation_warnings",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    moderatorId: text("moderator_id").notNull(),
    moderatorTag: text("moderator_tag").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIndex: index("moderation_warnings_guild_user_idx").on(
      table.guildId,
      table.userId,
    ),
  }),
);

export type ModerationLog = typeof moderationLogsTable.$inferSelect;
export type WarningRecord = typeof warningsTable.$inferSelect;

export const settingsValidationLimits = {
  maxAliases: 50,
  maxSetupRoles: 25,
  maxPermissionRoles: 25,
} as const;
