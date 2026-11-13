import {
  ChannelType,
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  type SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import type { GuildSettings } from "@workspace/db";

export type CommandCategory =
  | "setup"
  | "sanctions"
  | "warnings"
  | "messages"
  | "roles"
  | "information";

export type CommandDefinition = {
  name: string;
  description: string;
  category: CommandCategory;
  builder: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
};

type SlashBuilder = SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;

const reasonOption = (builder: SlashBuilder) =>
  builder.addStringOption((option) =>
    option
      .setName("reason")
      .setDescription("سبب تنفيذ الأمر")
      .setMaxLength(500),
  );

const targetOption = (builder: SlashBuilder) =>
  builder.addUserOption((option) =>
    option
      .setName("target")
      .setDescription("العضو المستهدف")
      .setRequired(true),
  );

function command(
  name: string,
  description: string,
  category: CommandCategory,
  builder: SlashBuilder,
): CommandDefinition {
  return { name, description, category, builder };
}

export const COMMAND_DEFINITIONS: CommandDefinition[] = [
  command(
    "setup",
    "فتح لوحة إعدادات البوت",
    "setup",
    new SlashCommandBuilder().setName("setup").setDescription("فتح لوحة إعدادات البوت"),
  ),
  command(
    "ban",
    "حظر عضو من السيرفر",
    "sanctions",
    reasonOption(
      targetOption(
        new SlashCommandBuilder().setName("ban").setDescription("حظر عضو من السيرفر"),
      ),
    ),
  ),
  command(
    "unban",
    "فك حظر مستخدم",
    "sanctions",
    reasonOption(
      new SlashCommandBuilder()
        .setName("unban")
        .setDescription("فك حظر مستخدم")
        .addStringOption((option) =>
          option
            .setName("user_id")
            .setDescription("معرّف المستخدم المحظور")
            .setRequired(true)
            .setMinLength(17)
            .setMaxLength(20),
        ),
    ),
  ),
  command(
    "kick",
    "طرد عضو من السيرفر",
    "sanctions",
    reasonOption(
      targetOption(
        new SlashCommandBuilder().setName("kick").setDescription("طرد عضو من السيرفر"),
      ),
    ),
  ),
  command(
    "timeout",
    "إسكات عضو لمدة محددة",
    "sanctions",
    reasonOption(
      targetOption(
        new SlashCommandBuilder()
          .setName("timeout")
          .setDescription("إسكات عضو لمدة محددة"),
      ).addIntegerOption((option) =>
        option
          .setName("duration")
          .setDescription("المدة بالثواني، أو المدة الافتراضية")
          .setMinValue(1)
          .setMaxValue(2_419_200),
      ),
    ),
  ),
  command(
    "untimeout",
    "إزالة الإسكات عن عضو",
    "sanctions",
    reasonOption(
      targetOption(
        new SlashCommandBuilder()
          .setName("untimeout")
          .setDescription("إزالة الإسكات عن عضو"),
      ),
    ),
  ),
  command(
    "warn",
    "إعطاء تحذير لعضو",
    "warnings",
    reasonOption(
      targetOption(
        new SlashCommandBuilder().setName("warn").setDescription("إعطاء تحذير لعضو"),
      ),
    ),
  ),
  command(
    "warnings",
    "عرض تحذيرات عضو",
    "warnings",
    targetOption(
      new SlashCommandBuilder()
        .setName("warnings")
        .setDescription("عرض تحذيرات عضو"),
    ),
  ),
  command(
    "clearwarns",
    "مسح تحذيرات عضو",
    "warnings",
    reasonOption(
      targetOption(
        new SlashCommandBuilder()
          .setName("clearwarns")
          .setDescription("مسح تحذيرات عضو"),
      ),
    ),
  ),
  command(
    "deletewarn",
    "حذف تحذير محدد",
    "warnings",
    reasonOption(
      new SlashCommandBuilder()
        .setName("deletewarn")
        .setDescription("حذف تحذير محدد")
        .addIntegerOption((option) =>
          option
            .setName("warning_id")
            .setDescription("رقم التحذير")
            .setRequired(true)
            .setMinValue(1),
        ),
    ),
  ),
  command(
    "clear",
    "حذف عدد من الرسائل",
    "messages",
    reasonOption(
      new SlashCommandBuilder()
        .setName("clear")
        .setDescription("حذف عدد من الرسائل")
        .addIntegerOption((option) =>
          option
            .setName("count")
            .setDescription("عدد الرسائل، من 1 إلى 100")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100),
        )
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("الروم المستهدف، أو الروم الحالي")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    ),
  ),
  command(
    "lock",
    "قفل روم المحادثة",
    "messages",
    reasonOption(
      new SlashCommandBuilder()
        .setName("lock")
        .setDescription("قفل روم المحادثة")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("الروم المستهدف، أو الروم الحالي")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    ),
  ),
  command(
    "unlock",
    "فتح روم المحادثة",
    "messages",
    reasonOption(
      new SlashCommandBuilder()
        .setName("unlock")
        .setDescription("فتح روم المحادثة")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("الروم المستهدف، أو الروم الحالي")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    ),
  ),
  command(
    "slowmode",
    "تحديد الوضع البطيء للروم",
    "messages",
    reasonOption(
      new SlashCommandBuilder()
        .setName("slowmode")
        .setDescription("تحديد الوضع البطيء للروم")
        .addIntegerOption((option) =>
          option
            .setName("seconds")
            .setDescription("المدة بالثواني، من 0 إلى 21600")
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(21600),
        )
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("الروم المستهدف، أو الروم الحالي")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    ),
  ),
  command(
    "addrole",
    "إعطاء رتبة لعضو",
    "roles",
    reasonOption(
      targetOption(
        new SlashCommandBuilder()
          .setName("addrole")
          .setDescription("إعطاء رتبة لعضو")
          .addRoleOption((option) =>
            option.setName("role").setDescription("الرتبة المطلوب إعطاؤها").setRequired(true),
          ),
      ),
    ),
  ),
  command(
    "removerole",
    "إزالة رتبة من عضو",
    "roles",
    reasonOption(
      targetOption(
        new SlashCommandBuilder()
          .setName("removerole")
          .setDescription("إزالة رتبة من عضو")
          .addRoleOption((option) =>
            option.setName("role").setDescription("الرتبة المطلوب إزالتها").setRequired(true),
          ),
      ),
    ),
  ),
  command(
    "roleinfo",
    "عرض معلومات رتبة",
    "information",
    new SlashCommandBuilder()
      .setName("roleinfo")
      .setDescription("عرض معلومات رتبة")
      .addRoleOption((option) =>
        option.setName("role").setDescription("الرتبة المطلوبة").setRequired(true),
      ),
  ),
  command(
    "userinfo",
    "عرض معلومات عضو",
    "information",
    new SlashCommandBuilder()
      .setName("userinfo")
      .setDescription("عرض معلومات عضو")
      .addUserOption((option) =>
        option.setName("target").setDescription("العضو المطلوب"),
      ),
  ),
  command(
    "serverinfo",
    "عرض معلومات السيرفر",
    "information",
    new SlashCommandBuilder()
      .setName("serverinfo")
      .setDescription("عرض معلومات السيرفر"),
  ),
  command(
    "avatar",
    "عرض صورة عضو",
    "information",
    new SlashCommandBuilder()
      .setName("avatar")
      .setDescription("عرض صورة عضو")
      .addUserOption((option) =>
        option.setName("target").setDescription("العضو المطلوب"),
      ),
  ),
  command(
    "nick",
    "تغيير لقب عضو",
    "roles",
    reasonOption(
      targetOption(
        new SlashCommandBuilder()
          .setName("nick")
          .setDescription("تغيير لقب عضو"),
      ).addStringOption((option) =>
        option
          .setName("nickname")
          .setDescription("اللقب الجديد، أو اتركه فارغاً لإزالة اللقب")
          .setMaxLength(32),
      ),
    ),
  ),
];

export const COMMAND_BY_NAME = new Map(
  COMMAND_DEFINITIONS.map((definition) => [definition.name, definition]),
);

export const COMMAND_CATALOG = COMMAND_DEFINITIONS.map(
  ({ name, description, category }) => ({ name, description, category }),
);

export const COMMANDS_WITH_REASON = new Set([
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

export function buildGuildCommands(
  settings: GuildSettings,
): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  const disabled = new Set(settings.disabledCommands);
  const commands = COMMAND_DEFINITIONS
    .filter((definition) => !disabled.has(definition.name))
    .map((definition) => definition.builder.toJSON());

  const aliases = Object.entries(settings.aliases).slice(0, 50);
  for (const [alias, targetName] of aliases) {
    if (disabled.has(targetName) || COMMAND_BY_NAME.has(alias)) continue;
    const target = COMMAND_BY_NAME.get(targetName);
    if (!target) continue;
    const aliasDefinition = target.builder.toJSON();
    aliasDefinition.name = alias;
    aliasDefinition.description = `اختصار للأمر /${targetName}`.slice(0, 100);
    commands.push(aliasDefinition);
  }
  return commands;
}
