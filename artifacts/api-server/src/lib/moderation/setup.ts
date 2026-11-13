import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type Guild,
  type Interaction,
  type ModalSubmitInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import {
  DEFAULT_GUILD_SETTINGS,
  type GuildSettings,
} from "@workspace/db";
import { logger } from "../logger";
import {
  COMMAND_BY_NAME,
  COMMAND_DEFINITIONS,
  COMMANDS_WITH_REASON,
  buildGuildCommands,
} from "./commands";
import { recordAudit } from "./audit";
import { canManageSetup, fetchActorMember } from "./guards";
import { getGuildSettings, saveGuildSettings } from "./store";

type SelectInteraction =
  | StringSelectMenuInteraction
  | RoleSelectMenuInteraction
  | ChannelSelectMenuInteraction;
type ComponentInteraction = ButtonInteraction | SelectInteraction;
type SettingAction = "sanctions" | "warnings" | "roles" | "messages" | "settings";

const COLORS = {
  primary: 0x23866d,
  warning: 0xd79a43,
  danger: 0xc84848,
};

const LOG_LABELS: Record<SettingAction, string> = {
  sanctions: "العقوبات",
  warnings: "التحذيرات",
  roles: "الرتب والألقاب",
  messages: "إدارة المحادثات",
  settings: "تغييرات الإعدادات",
};

function panel(title: string, description: string, color = COLORS.primary) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "بوت الإدارة الاحترافي · إعدادات السيرفر فقط" })
    .setTimestamp();
}

function button(
  customId: string,
  label: string,
  style: ButtonStyle = ButtonStyle.Secondary,
) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
}

function row(...buttons: ButtonBuilder[]) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
}

function sectionButtons() {
  return [
    row(
      button("setup:permissions", "صلاحيات الأوامر"),
      button("setup:aliases", "الاختصارات"),
      button("setup:protection", "الحماية"),
      button("setup:logs", "السجلات"),
    ),
    row(
      button("setup:settings", "إعدادات الأوامر"),
      button("setup:view", "عرض الإعدادات"),
      button("setup:reset", "إعادة الضبط", ButtonStyle.Danger),
    ),
  ];
}

function overviewEmbed(settings: GuildSettings) {
  const aliases = Object.keys(settings.aliases).length;
  const permittedCommands = Object.values(settings.commandPermissions).filter(
    (roles) => roles.length > 0,
  ).length;
  return panel(
    "لوحة إعداد بوت الإدارة",
    "اختر قسماً لإدارة إعدادات هذا السيرفر. لا يطّلع الآخرون على اللوحة، وكل تغيير يُطبّق مباشرة بعد الحفظ.",
  ).addFields(
    {
      name: "الصلاحيات",
      value: `${permittedCommands} أمر مضبوط على رتب مخصصة`,
      inline: true,
    },
    { name: "الاختصارات", value: `${aliases} اختصار`, inline: true },
    {
      name: "الحماية الهرمية",
      value: settings.protectionEnabled ? "مفعّلة" : "متوقفة",
      inline: true,
    },
    {
      name: "سجل الإدارة",
      value: settings.logChannelId ? `<#${settings.logChannelId}>` : "غير محدد",
      inline: true,
    },
  );
}

function backRow() {
  return row(button("setup:home", "العودة إلى اللوحة", ButtonStyle.Primary));
}

function commandSelect(customId: string, placeholder: string) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setMinValues(1)
    .setMaxValues(1);
  for (const definition of COMMAND_DEFINITIONS.filter(
    (entry) => entry.category !== "setup",
  )) {
    menu.addOptions({
      label: `/${definition.name}`,
      description: definition.description.slice(0, 90),
      value: definition.name,
    });
  }
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function setupRolesMenu(customId: string) {
  return new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder("اختر الرتب المصرح لها")
      .setMinValues(0)
      .setMaxValues(25),
  );
}

function logsEmbed(settings: GuildSettings) {
  const enabled = settings.logTypes.map((type) => LOG_LABELS[type as SettingAction]);
  return panel(
    "إعدادات السجلات",
    "اختر روم السجلات، ثم فعّل أنواع العمليات التي تريد تسجيلها. تُحفظ السجلات أيضاً في قاعدة البيانات.",
  ).addFields(
    {
      name: "روم السجلات",
      value: settings.logChannelId ? `<#${settings.logChannelId}>` : "غير محدد",
      inline: true,
    },
    {
      name: "الأنواع المفعّلة",
      value: enabled.length ? enabled.join("، ") : "لا توجد أنواع مفعّلة",
      inline: false,
    },
  );
}

function logsControls(settings: GuildSettings) {
  const channelRow = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("setup:logs:channel")
      .setPlaceholder("تحديد روم سجلات الإدارة")
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1)
      .setMaxValues(1),
  );
  const toggles = (Object.keys(LOG_LABELS) as SettingAction[]).map((type) =>
    button(
      `setup:logs:toggle:${type}`,
      `${settings.logTypes.includes(type) ? "✓ " : ""}${LOG_LABELS[type]}`,
      settings.logTypes.includes(type) ? ButtonStyle.Success : ButtonStyle.Secondary,
    ),
  );
  return [
    channelRow,
    row(button("setup:logs:clear", "إزالة روم السجلات", ButtonStyle.Danger)),
    row(...toggles.slice(0, 3)),
    row(...toggles.slice(3)),
    backRow(),
  ];
}

function aliasesEmbed(settings: GuildSettings) {
  const aliases = Object.entries(settings.aliases);
  const shown = aliases.slice(0, 20);
  const list = shown.length
    ? shown.map(([alias, target]) => `\`/${alias}\` ← \`/${target}\``).join("\n")
    : "لا توجد اختصارات بعد.";
  return panel(
    "إدارة الاختصارات",
    "كل اختصار ينفذ الأمر الأصلي ويستخدم صلاحياته وحمايته. الاسم يقبل أحرفاً إنجليزية صغيرة وأرقاماً وشرطة أو شرطة سفلية.",
  ).addFields(
    { name: "الاختصارات الحالية", value: list, inline: false },
    {
      name: "العدد",
      value: `${aliases.length} / 50`,
      inline: true,
    },
  );
}

function aliasesControls(settings: GuildSettings) {
  const controls: Array<
    ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>
  > = [
    row(
      button("setup:alias:create", "إضافة اختصار", ButtonStyle.Success),
      button("setup:aliases", "تحديث القائمة"),
    ),
  ];
  const aliases = Object.entries(settings.aliases);
  if (aliases.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId("setup:alias:choose")
      .setPlaceholder("اختر اختصاراً")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        aliases.slice(0, 25).map(([alias, target]) => ({
          label: `/${alias}`,
          description: `مرتبط بالأمر /${target}`.slice(0, 90),
          value: alias,
        })),
      );
    controls.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
    );
  }
  controls.push(backRow());
  return controls;
}

function protectionEmbed(settings: GuildSettings) {
  return panel(
    "الحماية الهرمية",
    "تُفحص رتب العضو الحالية وترتيب رتب البوت قبل العقوبات أو تعديل الألقاب والرتب. مالك السيرفر محمي افتراضياً.",
    settings.protectionEnabled ? COLORS.primary : COLORS.warning,
  ).addFields(
    {
      name: "الحماية العامة",
      value: settings.protectionEnabled ? "مفعّلة" : "متوقفة",
      inline: true,
    },
    {
      name: "منع المساوي والأعلى",
      value: settings.protectEqualOrHigher ? "مفعّل" : "متوقف",
      inline: true,
    },
    {
      name: "حماية المالك",
      value: "دائمة ولا يمكن تعطيلها",
      inline: true,
    },
  );
}

function protectionControls(settings: GuildSettings) {
  return [
    row(
      button(
        "setup:protection:toggle:protectionEnabled",
        settings.protectionEnabled ? "إيقاف الحماية العامة" : "تفعيل الحماية العامة",
        settings.protectionEnabled ? ButtonStyle.Danger : ButtonStyle.Success,
      ),
      button(
        "setup:protection:toggle:protectEqualOrHigher",
        settings.protectEqualOrHigher
          ? "السماح بالمساوي والأعلى"
          : "منع المساوي والأعلى",
        ButtonStyle.Secondary,
      ),
    ),
    backRow(),
  ];
}

function settingsEmbed(settings: GuildSettings) {
  const reasonCommands = settings.reasonRequiredCommands.length
    ? settings.reasonRequiredCommands.map((name) => `/${name}`).join("، ")
    : "لا توجد أوامر";
  const disabled = settings.disabledCommands.length
    ? settings.disabledCommands.map((name) => `/${name}`).join("، ")
    : "لا توجد أوامر معطّلة";
  const rule = settings.autoWarnRule;
  return panel(
    "إعدادات الأوامر",
    "إعدادات الأسباب والمدد والتحذيرات التلقائية ومديري لوحة التحكم.",
  ).addFields(
    {
      name: "مديرو لوحة /setup",
      value: settings.setupRoleIds.length
        ? settings.setupRoleIds.map((id) => `<@&${id}>`).join("، ")
        : "مالك السيرفر فقط",
      inline: false,
    },
    {
      name: "السبب مطلوب في",
      value: reasonCommands,
      inline: false,
    },
    {
      name: "المدة الافتراضية للإسكات",
      value: `${Math.floor(settings.defaultTimeoutSeconds / 60)} دقيقة`,
      inline: true,
    },
    {
      name: "العقوبة التلقائية",
      value: rule.enabled
        ? `${rule.action} بعد ${rule.threshold} تحذيرات`
        : "متوقفة",
      inline: true,
    },
    { name: "الأوامر المعطّلة", value: disabled, inline: false },
  );
}

function settingsControls(settings: GuildSettings) {
  const reasonMenu = new StringSelectMenuBuilder()
    .setCustomId("setup:reason:toggle")
    .setPlaceholder("اختر أمراً لتبديل اشتراط السبب")
    .setMinValues(1)
    .setMaxValues(1);
  const disabledMenu = new StringSelectMenuBuilder()
    .setCustomId("setup:command:toggle")
    .setPlaceholder("اختر أمراً لتفعيله أو تعطيله")
    .setMinValues(1)
    .setMaxValues(1);
  for (const definition of COMMAND_DEFINITIONS.filter(
    (entry) => COMMANDS_WITH_REASON.has(entry.name),
  )) {
    reasonMenu.addOptions({
      label: `/${definition.name}`,
      description: settings.reasonRequiredCommands.includes(definition.name)
        ? "السبب مطلوب حالياً — اختر لإلغاء الإلزام"
        : "السبب اختياري حالياً — اختر لإلزامه",
      value: definition.name,
    });
    disabledMenu.addOptions({
      label: `/${definition.name}`,
      description: settings.disabledCommands.includes(definition.name)
        ? "معطّل — اختر لإعادة تفعيله"
        : "مفعّل — اختر لتعطيله",
      value: definition.name,
    });
  }
  return [
    setupRolesMenu("setup:settings:setup-roles"),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(reasonMenu),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(disabledMenu),
    row(
      button("setup:settings:timeout", "تغيير مدة الإسكات الافتراضية"),
      button("setup:settings:auto-warn", "إعداد عتبة التحذيرات"),
      button(
        "setup:settings:auto-warn-toggle",
        settings.autoWarnRule.enabled
          ? "إيقاف العقوبة التلقائية"
          : "تفعيل العقوبة التلقائية",
        settings.autoWarnRule.enabled ? ButtonStyle.Danger : ButtonStyle.Success,
      ),
    ),
    backRow(),
  ];
}

function viewEmbed(guild: Guild, settings: GuildSettings) {
  const permissions = Object.entries(settings.commandPermissions)
    .filter(([, roles]) => roles.length)
    .map(([name, roles]) => `**/${name}:** ${roles.map((id) => `<@&${id}>`).join(", ")}`);
  const aliases = Object.entries(settings.aliases).map(
    ([alias, target]) => `\`/${alias}\` → \`/${target}\``,
  );
  return panel(
    "ملخص إعدادات السيرفر",
    "عرض سريع للإعدادات المحفوظة حالياً.",
  ).addFields(
    {
      name: "صلاحيات الأوامر",
      value: permissions.slice(0, 8).join("\n") || "كل الأوامر لمالك السيرفر فقط حتى تحدد الرتب.",
      inline: false,
    },
    {
      name: "الاختصارات",
      value: aliases.slice(0, 12).join("\n") || "لا توجد اختصارات.",
      inline: false,
    },
    {
      name: "الحماية",
      value: `الحماية ${settings.protectionEnabled ? "مفعّلة" : "متوقفة"} · مالك السيرفر محمي دائماً · حماية المساوي والأعلى ${settings.protectEqualOrHigher ? "مفعّلة" : "متوقفة"}`,
      inline: false,
    },
    {
      name: "روم السجلات",
      value: settings.logChannelId ? `<#${settings.logChannelId}>` : "غير محدد",
      inline: true,
    },
    {
      name: "أنواع السجلات",
      value: settings.logTypes.map((type) => LOG_LABELS[type as SettingAction]).join("، ") || "متوقفة",
      inline: true,
    },
    {
      name: "إعدادات السيرفر",
      value: `السيرفر: ${guild.name}\nمديرو /setup: ${settings.setupRoleIds.map((id) => `<@&${id}>`).join(", ") || "المالك فقط"}\nالأوامر المعطّلة: ${settings.disabledCommands.map((name) => `/${name}`).join(", ") || "لا يوجد"}`,
      inline: false,
    },
  );
}

function configModal(
  customId: string,
  title: string,
  inputs: TextInputBuilder[],
) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
  for (const input of inputs) {
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(input),
    );
  }
  return modal;
}

function textInput(
  customId: string,
  label: string,
  value?: string,
  placeholder?: string,
) {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80);
  if (value) input.setValue(value);
  if (placeholder) input.setPlaceholder(placeholder);
  return input;
}

async function logSetupChange(
  guild: Guild,
  settings: GuildSettings,
  actor: { id: string; tag: string },
  details: string,
) {
  try {
    await recordAudit(guild, settings, {
      guildId: guild.id,
      actorId: actor.id,
      actorTag: actor.tag,
      commandName: "setup",
      reason: "تعديل إعدادات لوحة الإدارة",
      success: true,
      details,
    });
  } catch (error) {
    logger.error({ err: error, guildId: guild.id }, "Failed to record setup change");
  }
}

async function syncCommands(guild: Guild, settings: GuildSettings) {
  await guild.commands.set(buildGuildCommands(settings));
}

export async function showSetupPanel(
  interaction: Interaction,
): Promise<void> {
  if (!interaction.isChatInputCommand()) return;
  const guild = interaction.guild;
  if (!guild) {
    await interaction.deleteReply().catch(() => undefined);
    return;
  }
  const actor = await fetchActorMember(guild, interaction.user.id).catch(
    () => null,
  );
  const settings = await getGuildSettings(guild.id);
  if (!actor || !canManageSetup(actor, guild, settings)) {
    await interaction.deleteReply().catch(() => undefined);
    return;
  }
  await interaction.editReply({
    embeds: [overviewEmbed(settings)],
    components: sectionButtons(),
  });
}

export async function handleSetupComponent(
  interaction: Interaction,
): Promise<boolean> {
  if (
    !interaction.isButton() &&
    !interaction.isStringSelectMenu() &&
    !interaction.isRoleSelectMenu() &&
    !interaction.isChannelSelectMenu() &&
    !interaction.isModalSubmit()
  ) {
    return false;
  }
  if (!interaction.customId.startsWith("setup:")) return false;

  const guild = interaction.guild;
  if (!guild) {
    if (interaction.isModalSubmit()) {
      await interaction.reply({
        content: "لوحة الإعدادات متاحة داخل السيرفر فقط.",
        ephemeral: true,
      });
    }
    return true;
  }

  const actor = await fetchActorMember(guild, interaction.user.id).catch(
    () => null,
  );
  const settings = await getGuildSettings(guild.id);
  if (!actor || !canManageSetup(actor, guild, settings)) {
    if (interaction.isModalSubmit() || interaction.isButton() || interaction.isStringSelectMenu() || interaction.isRoleSelectMenu() || interaction.isChannelSelectMenu()) {
      await interaction.reply({
        content: "لا يمكنك استخدام لوحة الإعدادات هذه.",
        ephemeral: true,
      }).catch(() => undefined);
    }
    return true;
  }

  const actionActor = { id: interaction.user.id, tag: interaction.user.tag };
  const customId = interaction.customId;

  if (interaction.isButton()) {
    if (customId === "setup:home") {
      await interaction.update({
        embeds: [overviewEmbed(settings)],
        components: sectionButtons(),
      });
      return true;
    }
    if (customId === "setup:permissions") {
      await interaction.update({
        embeds: [panel("صلاحيات الأوامر", "اختر أمراً لعرض الرتب المسموح لها. عند اختيار الرتب تُحفظ الصلاحية وتُطبّق مباشرة.")],
        components: [commandSelect("setup:permissions:choose", "اختر أمراً") , backRow()],
      });
      return true;
    }
    if (customId === "setup:aliases") {
      await interaction.update({
        embeds: [aliasesEmbed(settings)],
        components: aliasesControls(settings),
      });
      return true;
    }
    if (customId === "setup:alias:create") {
      await interaction.showModal(
        configModal("setup:alias:create-modal", "إضافة اختصار", [
          textInput("alias", "اسم الاختصار", undefined, "مثال: softban"),
          textInput("target", "اسم الأمر الأصلي دون /", undefined, "مثال: ban"),
        ]),
      );
      return true;
    }
    if (customId === "setup:alias:edit") {
      await interaction.reply({
        content: "اختر الاختصار من القائمة أولاً.",
        ephemeral: true,
      });
      return true;
    }
    if (customId.startsWith("setup:alias:edit:")) {
      const oldAlias = customId.slice("setup:alias:edit:".length);
      const target = settings.aliases[oldAlias];
      if (!target) {
        await interaction.reply({ content: "لم يعد هذا الاختصار موجوداً.", ephemeral: true });
        return true;
      }
      await interaction.showModal(
        configModal(`setup:alias:edit-modal:${oldAlias}`, "تعديل الاختصار", [
          textInput("alias", "اسم الاختصار الجديد", oldAlias),
          textInput("target", "اسم الأمر الأصلي دون /", target),
        ]),
      );
      return true;
    }
    if (customId.startsWith("setup:alias:delete:")) {
      const alias = customId.slice("setup:alias:delete:".length);
      delete settings.aliases[alias];
      const saved = await saveGuildSettings(guild.id, settings);
      await syncCommands(guild, saved);
      await logSetupChange(guild, saved, actionActor, `حُذف الاختصار /${alias}`);
      await interaction.update({
        embeds: [aliasesEmbed(saved).setDescription("تم حذف الاختصار وتحديث أوامر السيرفر.")],
        components: aliasesControls(saved),
      });
      return true;
    }
    if (customId === "setup:protection") {
      await interaction.update({
        embeds: [protectionEmbed(settings)],
        components: protectionControls(settings),
      });
      return true;
    }
    if (customId.startsWith("setup:protection:toggle:")) {
      const key = customId.slice("setup:protection:toggle:".length) as
        | "protectionEnabled"
        | "protectEqualOrHigher";
      settings[key] = !settings[key];
      const saved = await saveGuildSettings(guild.id, settings);
      await logSetupChange(guild, saved, actionActor, `تغيير ${key} إلى ${saved[key]}`);
      await interaction.update({
        embeds: [protectionEmbed(saved)],
        components: protectionControls(saved),
      });
      return true;
    }
    if (customId === "setup:logs") {
      await interaction.update({
        embeds: [logsEmbed(settings)],
        components: logsControls(settings),
      });
      return true;
    }
    if (customId.startsWith("setup:logs:toggle:")) {
      const type = customId.slice("setup:logs:toggle:".length) as SettingAction;
      if (settings.logTypes.includes(type)) {
        settings.logTypes = settings.logTypes.filter((entry) => entry !== type);
      } else {
        settings.logTypes.push(type);
      }
      const saved = await saveGuildSettings(guild.id, settings);
      await logSetupChange(guild, saved, actionActor, `تبديل نوع السجل: ${type}`);
      await interaction.update({
        embeds: [logsEmbed(saved)],
        components: logsControls(saved),
      });
      return true;
    }
    if (customId === "setup:logs:clear") {
      settings.logChannelId = null;
      const saved = await saveGuildSettings(guild.id, settings);
      await logSetupChange(guild, saved, actionActor, "إزالة روم السجلات");
      await interaction.update({
        embeds: [logsEmbed(saved)],
        components: logsControls(saved),
      });
      return true;
    }
    if (customId === "setup:settings") {
      await interaction.update({
        embeds: [settingsEmbed(settings)],
        components: settingsControls(settings),
      });
      return true;
    }
    if (customId === "setup:settings:timeout") {
      await interaction.showModal(
        configModal("setup:settings:timeout-modal", "مدة الإسكات الافتراضية", [
          textInput(
            "seconds",
            "المدة بالثواني من 1 إلى 2419200",
            String(settings.defaultTimeoutSeconds),
          ),
        ]),
      );
      return true;
    }
    if (customId === "setup:settings:auto-warn") {
      const rule = settings.autoWarnRule;
      await interaction.showModal(
        configModal("setup:settings:auto-warn-modal", "عقوبة التحذيرات التلقائية", [
          textInput("threshold", "عدد التحذيرات", String(rule.threshold)),
          textInput("action", "العقوبة: timeout أو kick أو ban", rule.action),
          textInput("duration", "مدة الإسكات بالثواني", String(rule.durationSeconds)),
        ]),
      );
      return true;
    }
    if (customId === "setup:settings:auto-warn-toggle") {
      settings.autoWarnRule.enabled = !settings.autoWarnRule.enabled;
      const saved = await saveGuildSettings(guild.id, settings);
      await logSetupChange(guild, saved, actionActor, `تبديل العقوبة التلقائية إلى ${saved.autoWarnRule.enabled}`);
      await interaction.update({
        embeds: [settingsEmbed(saved)],
        components: settingsControls(saved),
      });
      return true;
    }
    if (customId === "setup:reset") {
      await interaction.update({
        embeds: [panel("تأكيد إعادة الضبط", "سيؤدي هذا إلى إعادة صلاحيات الأوامر والاختصارات والحماية والسجلات وإعدادات العقوبات إلى القيم الافتراضية. لا يمكن التراجع عن هذا التغيير.", COLORS.danger)],
        components: [
          row(
            button("setup:reset:confirm", "إعادة الضبط", ButtonStyle.Danger),
            button("setup:home", "إلغاء", ButtonStyle.Secondary),
          ),
        ],
      });
      return true;
    }
    if (customId === "setup:reset:confirm") {
      const defaults = structuredClone(DEFAULT_GUILD_SETTINGS);
      const saved = await saveGuildSettings(guild.id, defaults);
      await syncCommands(guild, saved);
      await logSetupChange(guild, saved, actionActor, "إعادة ضبط إعدادات السيرفر");
      await interaction.update({
        embeds: [overviewEmbed(saved).setDescription("أُعيدت الإعدادات الافتراضية وطُبّقت على السيرفر.")],
        components: sectionButtons(),
      });
      return true;
    }
    if (customId === "setup:view") {
      await interaction.update({
        embeds: [viewEmbed(guild, settings)],
        components: [backRow()],
      });
      return true;
    }
  }

  if (interaction.isStringSelectMenu()) {
    if (customId === "setup:permissions:choose") {
      const commandName = interaction.values[0];
      const definition = COMMAND_BY_NAME.get(commandName);
      if (!definition) {
        await interaction.reply({ content: "الأمر غير موجود.", ephemeral: true });
        return true;
      }
      const roleIds = settings.commandPermissions[commandName] ?? [];
      await interaction.update({
        embeds: [
          panel(
            `صلاحيات /${commandName}`,
            `حدد الرتب المسموح لها باستخدام هذا الأمر. الرتب الحالية: ${roleIds.map((id) => `<@&${id}>`).join("، ") || "مالك السيرفر فقط"}. سيُحفظ اختيارك فوراً.`,
          ),
        ],
        components: [
          setupRolesMenu(`setup:permissions:save:${commandName}`),
          backRow(),
        ],
      });
      return true;
    }
    if (customId.startsWith("setup:reason:toggle")) {
      const commandName = interaction.values[0];
      if (settings.reasonRequiredCommands.includes(commandName)) {
        settings.reasonRequiredCommands = settings.reasonRequiredCommands.filter((name) => name !== commandName);
      } else {
        settings.reasonRequiredCommands.push(commandName);
      }
      const saved = await saveGuildSettings(guild.id, settings);
      await logSetupChange(guild, saved, actionActor, `تبديل إلزام السبب في /${commandName}`);
      await interaction.update({
        embeds: [settingsEmbed(saved)],
        components: settingsControls(saved),
      });
      return true;
    }
    if (customId === "setup:command:toggle") {
      const commandName = interaction.values[0];
      if (settings.disabledCommands.includes(commandName)) {
        settings.disabledCommands = settings.disabledCommands.filter((name) => name !== commandName);
      } else {
        settings.disabledCommands.push(commandName);
      }
      const saved = await saveGuildSettings(guild.id, settings);
      await syncCommands(guild, saved);
      await logSetupChange(guild, saved, actionActor, `تبديل حالة /${commandName}`);
      await interaction.update({
        embeds: [settingsEmbed(saved)],
        components: settingsControls(saved),
      });
      return true;
    }
    if (customId === "setup:alias:choose") {
      const alias = interaction.values[0];
      const target = settings.aliases[alias];
      if (!target) {
        await interaction.reply({ content: "لم يعد هذا الاختصار موجوداً.", ephemeral: true });
        return true;
      }
      await interaction.update({
        embeds: [
          panel(
            `اختصار /${alias}`,
            `الأمر الأصلي: /${target}. سيتم تطبيق صلاحيات الأمر الأصلي وحمايته.`,
          ),
        ],
        components: [
          row(
            button(`setup:alias:edit:${alias}`, "تعديل", ButtonStyle.Primary),
            button(`setup:alias:delete:${alias}`, "حذف", ButtonStyle.Danger),
            button("setup:aliases", "رجوع"),
          ),
        ],
      });
      return true;
    }
  }

  if (interaction.isRoleSelectMenu()) {
    if (customId.startsWith("setup:permissions:save:")) {
      const commandName = customId.slice("setup:permissions:save:".length);
      if (!COMMAND_BY_NAME.has(commandName)) {
        await interaction.reply({ content: "الأمر غير موجود.", ephemeral: true });
        return true;
      }
      settings.commandPermissions[commandName] = interaction.values;
      const saved = await saveGuildSettings(guild.id, settings);
      await logSetupChange(guild, saved, actionActor, `حفظ صلاحيات /${commandName}`);
      await interaction.update({
        embeds: [
          panel(
            `تم حفظ صلاحيات /${commandName}`,
            interaction.values.length
              ? `الرتب المسموح لها: ${interaction.values.map((id) => `<@&${id}>`).join("، ")}.`
              : "لم تُحدد رتب؛ سيبقى الأمر متاحاً لمالك السيرفر فقط.",
          ),
        ],
        components: [
          setupRolesMenu(`setup:permissions:save:${commandName}`),
          backRow(),
        ],
      });
      return true;
    }
    if (customId === "setup:settings:setup-roles") {
      settings.setupRoleIds = interaction.values;
      const saved = await saveGuildSettings(guild.id, settings);
      await logSetupChange(guild, saved, actionActor, "تحديث رتب مديري لوحة /setup");
      await interaction.update({
        embeds: [settingsEmbed(saved).setDescription("تم حفظ رتب مديري لوحة الإعدادات.")],
        components: settingsControls(saved),
      });
      return true;
    }
  }

  if (interaction.isChannelSelectMenu() && customId === "setup:logs:channel") {
    settings.logChannelId = interaction.values[0] ?? null;
    const saved = await saveGuildSettings(guild.id, settings);
    await logSetupChange(guild, saved, actionActor, "تحديد روم سجلات الإدارة");
    await interaction.update({
      embeds: [logsEmbed(saved)],
      components: logsControls(saved),
    });
    return true;
  }

  if (interaction.isModalSubmit()) {
    await interaction.deferReply({ ephemeral: true });
    if (customId === "setup:alias:create-modal" || customId.startsWith("setup:alias:edit-modal:")) {
      const isEdit = customId.startsWith("setup:alias:edit-modal:");
      const oldAlias = isEdit ? customId.slice("setup:alias:edit-modal:".length) : null;
      const alias = interaction.fields.getTextInputValue("alias").trim().toLowerCase();
      const targetName = interaction.fields.getTextInputValue("target").trim().replace(/^\/+/, "").toLowerCase();
      const validAlias = /^[a-z0-9_-]{1,32}$/.test(alias);
      const existingAliases = Object.keys(settings.aliases);
      const aliasCollision = COMMAND_BY_NAME.has(alias) || (existingAliases.includes(alias) && alias !== oldAlias);
      if (!validAlias || aliasCollision || !COMMAND_BY_NAME.has(targetName)) {
        await interaction.editReply({
          content: "تعذّر حفظ الاختصار. استخدم اسماً من 1 إلى 32 حرفاً إنجليزياً صغيراً أو رقماً أو _ أو -، واربطه باسم أمر موجود غير مستخدم.",
        });
        return true;
      }
      if (!isEdit && existingAliases.length >= 50) {
        await interaction.editReply({ content: "وصلت إلى الحد الأقصى وهو 50 اختصاراً." });
        return true;
      }
      if (oldAlias) delete settings.aliases[oldAlias];
      settings.aliases[alias] = targetName;
      const saved = await saveGuildSettings(guild.id, settings);
      await syncCommands(guild, saved);
      await logSetupChange(guild, saved, actionActor, `${isEdit ? "تعديل" : "إضافة"} الاختصار /${alias} إلى /${targetName}`);
      await interaction.editReply({ content: `تم حفظ /${alias} كاختصار للأمر /${targetName} وتسجيله في أوامر هذا السيرفر.` });
      return true;
    }
    if (customId === "setup:settings:timeout-modal") {
      const seconds = Number(interaction.fields.getTextInputValue("seconds").trim());
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 2_419_200) {
        await interaction.editReply({ content: "أدخل مدة صحيحة من 1 إلى 2419200 ثانية." });
        return true;
      }
      settings.defaultTimeoutSeconds = seconds;
      const saved = await saveGuildSettings(guild.id, settings);
      await logSetupChange(guild, saved, actionActor, `تغيير مدة الإسكات الافتراضية إلى ${seconds} ثانية`);
      await interaction.editReply({ content: `تم حفظ المدة الافتراضية: ${seconds} ثانية.` });
      return true;
    }
    if (customId === "setup:settings:auto-warn-modal") {
      const threshold = Number(interaction.fields.getTextInputValue("threshold").trim());
      const action = interaction.fields.getTextInputValue("action").trim().toLowerCase();
      const durationSeconds = Number(interaction.fields.getTextInputValue("duration").trim());
      if (
        !Number.isInteger(threshold) ||
        threshold < 2 ||
        threshold > 100 ||
        !["timeout", "kick", "ban"].includes(action) ||
        !Number.isInteger(durationSeconds) ||
        durationSeconds < 1 ||
        durationSeconds > 2_419_200
      ) {
        await interaction.editReply({
          content: "الإعداد غير صالح. عدد التحذيرات 2–100، والعقوبة timeout أو kick أو ban، والمدة 1–2419200 ثانية.",
        });
        return true;
      }
      settings.autoWarnRule = {
        ...settings.autoWarnRule,
        threshold,
        action: action as GuildSettings["autoWarnRule"]["action"],
        durationSeconds,
      };
      const saved = await saveGuildSettings(guild.id, settings);
      await logSetupChange(guild, saved, actionActor, "تحديث قاعدة العقوبات التلقائية للتحذيرات");
      await interaction.editReply({
        content: `تم حفظ القاعدة: ${action} بعد ${threshold} تحذيرات. ${saved.autoWarnRule.enabled ? "القاعدة مفعّلة." : "فعّلها من إعدادات الأوامر لتطبيقها."}`,
      });
      return true;
    }
    await interaction.editReply({ content: "هذا الإعداد غير معروف." });
    return true;
  }

  return true;
}
