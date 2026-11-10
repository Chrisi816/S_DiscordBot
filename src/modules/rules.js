const fs = require('node:fs');
const path = require('node:path');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ChannelType,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  AttachmentBuilder,
} = require('discord.js');
const { createStore, requireAdmin, requirePermissions, commandError } = require('../core/utils');
const { createCaptcha } = require('./verification-captcha');
const content = require('./rules-content');

const ACCENT_COLOR = 0xf91c2b;
const BANNER_PATH = path.join(__dirname, '../../assets/banner_rules.png');
const VERIFY_PREFIX = 'sservice:rules:verify:';
const LANGUAGE_PREFIX = 'sservice:rules:language:';
const CAPTCHA_PREFIX = 'sservice:captcha:';
const CAPTCHA_TTL_MS = 2 * 60 * 1000;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const MAX_CHALLENGES = 1000;
const PRIVILEGED_PERMISSIONS = [
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'ManageWebhooks',
  'KickMembers',
  'BanMembers',
  'ModerateMembers',
  'ManageMessages',
  'MentionEveryone',
];

const messages = {
  en: {
    title: '## 🔐 S-Service verification',
    instructions:
      'Find the **six digits** in the image and select the matching code below.\nYou have **2 minutes** and **one attempt**. Only you can see this captcha.',
    placeholder: 'Select the six digits shown in the image',
    already: '✅ You already have the verified role. You are ready to go!',
    expired:
      '⌛ This captcha has expired or was already used. Start verification again in the Rules channel.',
    wrong:
      '❌ That code did not match. Wait one minute, then start a new verification. After three failed attempts the wait is ten minutes.',
    changed: 'The verification setup changed. Please start a new verification.',
    success: '✅ Verification complete! Your member role has been added. Welcome to S-Service!',
    cooldown: (seconds) => `⏳ Please wait ${seconds} seconds before starting a new captcha.`,
    busy: 'Verification is already being processed. Please wait a moment.',
    disabled: 'Verification is not active here. Ask the team to configure the Rules channel.',
    foreign: 'This captcha belongs to another member. Start your own verification.',
  },
  de: {
    title: '## 🔐 S-Service-Verifizierung',
    instructions:
      'Erkenne die **sechs Ziffern** im Bild und wähle den passenden Code aus.\nDu hast **2 Minuten** und **einen Versuch**. Nur du kannst dieses Captcha sehen.',
    placeholder: 'Wähle die sechs Ziffern aus dem Bild',
    already: '✅ Du hast die verifizierte Rolle bereits. Du bist startklar!',
    expired:
      '⌛ Dieses Captcha ist abgelaufen oder wurde bereits verwendet. Starte die Verifizierung im Regelkanal erneut.',
    wrong:
      '❌ Der Code war falsch. Warte eine Minute und starte dann eine neue Verifizierung. Nach drei Fehlversuchen beträgt die Wartezeit zehn Minuten.',
    changed: 'Die Verifizierung wurde neu konfiguriert. Bitte starte eine neue Verifizierung.',
    success:
      '✅ Erfolgreich verifiziert! Deine Mitgliederrolle wurde hinzugefügt. Willkommen bei S-Service!',
    cooldown: (seconds) =>
      `⏳ Bitte warte ${seconds} Sekunden, bevor du ein neues Captcha startest.`,
    busy: 'Deine Verifizierung wird bereits verarbeitet. Bitte warte einen Moment.',
    disabled: 'Die Verifizierung ist hier nicht aktiv. Bitte wende dich an das Team.',
    foreign: 'Dieses Captcha gehört einem anderen Mitglied. Starte deine eigene Verifizierung.',
  },
};

function buildRulesPayload(guild, language = 'en') {
  const lang = language === 'de' ? 'de' : 'en';
  const text = content[lang];
  const panel = new ContainerBuilder()
    .setAccentColor(ACCENT_COLOR)
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL('attachment://banner_rules.png')
          .setDescription('S-Service — Rules & Verification'),
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder());
  const title = new TextDisplayBuilder().setContent(text.title);
  const intro = new TextDisplayBuilder().setContent(text.intro);
  const icon = guild.iconURL({ size: 128 });
  if (icon)
    panel.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(title, intro)
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(icon).setDescription('S-Service')),
    );
  else panel.addTextDisplayComponents(title, intro);
  for (const [heading, items] of [
    [text.rulesTitle, text.rules],
    [text.termsTitle, text.terms],
  ]) {
    panel
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          [heading, ...items.map((item, index) => `> **${index + 1}.** ${item}`)].join('\n'),
        ),
      );
  }
  panel
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${text.verifyTitle}\n${text.verifyText}`),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${VERIFY_PREFIX}${lang}`)
          .setLabel(text.verifyButton)
          .setEmoji('🔐')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`${LANGUAGE_PREFIX}${lang === 'de' ? 'en' : 'de'}`)
          .setLabel(text.languageLabel)
          .setEmoji(text.languageEmoji)
          .setStyle(ButtonStyle.Secondary),
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel(text.guidelines)
          .setStyle(ButtonStyle.Link)
          .setURL('https://discord.com/guidelines'),
        new ButtonBuilder()
          .setLabel(text.termsLabel)
          .setStyle(ButtonStyle.Link)
          .setURL('https://discord.com/terms'),
      ),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text.footer));
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [panel],
    files: [new AttachmentBuilder(BANNER_PATH, { name: 'banner_rules.png' })],
    allowedMentions: { parse: [] },
  };
}

function buildCaptchaPayload(session) {
  const text = messages[session.language];
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [
      new ContainerBuilder()
        .setAccentColor(ACCENT_COLOR)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`${text.title}\n${text.instructions}`),
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addMediaGalleryComponents(
          new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder()
              .setURL('attachment://captcha.png')
              .setDescription('Six-digit verification code. Select the matching digits below.'),
          ),
        )
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`${CAPTCHA_PREFIX}${session.id}`)
              .setPlaceholder(text.placeholder)
              .setMinValues(1)
              .setMaxValues(1)
              .addOptions(session.options),
          ),
        ),
    ],
    files: [new AttachmentBuilder(session.image, { name: 'captcha.png' })],
    allowedMentions: { parse: [] },
  };
}

function statusPayload(message) {
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [
      new ContainerBuilder()
        .setAccentColor(ACCENT_COLOR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(message)),
    ],
    attachments: [],
    allowedMentions: { parse: [] },
  };
}

module.exports = function createRules({
  guildId,
  statePath = path.join(__dirname, '../../data/rules.json'),
  captchaFactory = createCaptcha,
  now = Date.now,
}) {
  const store = createStore(statePath, { guildId, channelId: '', panelMessageId: '', roleId: '' });
  const sessions = new Map();
  const failures = new Map();
  const starting = new Set();
  const granting = new Set();
  let client;
  let setupInFlight = false;
  let cleanupTimer;
  const data = [
    new SlashCommandBuilder()
      .setName('rules')
      .setDescription('Manage the combined S-Service Rules & Verification panel')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .setDMPermission(false)
      .addSubcommand((sub) =>
        sub
          .setName('create')
          .setDescription('Post or update one combined rules and verification panel')
          .addRoleOption((option) =>
            option
              .setName('role')
              .setDescription('Member role granted after a correct captcha')
              .setRequired(true),
          )
          .addChannelOption((option) =>
            option
              .setName('channel')
              .setDescription('Combined Rules & Verification channel (defaults to here)')
              .addChannelTypes(ChannelType.GuildText),
          ),
      )
      .addSubcommand((sub) =>
        sub.setName('status').setDescription('Show the configured Rules channel and verified role'),
      )
      .addSubcommand((sub) =>
        sub
          .setName('disable')
          .setDescription('Disable new verifications without removing existing roles'),
      ),
  ];

  function configured() {
    const settings = store.get();
    return (
      settings.guildId === guildId &&
      settings.channelId &&
      settings.panelMessageId &&
      settings.roleId
    );
  }
  function signature() {
    const settings = store.get();
    return `${settings.channelId}:${settings.panelMessageId}:${settings.roleId}`;
  }
  async function validateRole(guild, roleId) {
    const role = await guild.roles.fetch(roleId);
    const me = await guild.members.fetchMe();
    if (
      !role ||
      role.id === guild.id ||
      role.managed ||
      !role.editable ||
      !me.permissions.has(PermissionFlagsBits.ManageRoles)
    ) {
      throw new Error(
        'Choose a regular member role below the bot role. The bot needs ManageRoles; managed roles and @everyone cannot be used.',
      );
    }
    if (PRIVILEGED_PERMISSIONS.some((name) => role.permissions.has(PermissionFlagsBits[name]))) {
      throw new Error(
        'The verification role must not grant administrator or moderation permissions. Choose a normal member role.',
      );
    }
    return role;
  }
  async function validateChannel(channel) {
    if (channel?.guildId !== guildId || channel.type !== ChannelType.GuildText)
      throw new Error('Choose a text channel on the S-Service server.');
    await requirePermissions(channel, [
      'ViewChannel',
      'SendMessages',
      'ReadMessageHistory',
      'AttachFiles',
      'EmbedLinks',
    ]);
    fs.accessSync(BANNER_PATH, fs.constants.R_OK);
  }
  async function findPanel(channel, messageId) {
    if (!messageId) return null;
    try {
      const message = await channel.messages.fetch(messageId);
      if (message.author.id !== client.user.id)
        throw new Error('The saved rules message belongs to a different bot.');
      return message;
    } catch (error) {
      if (error.code === 10008) return null;
      throw error;
    }
  }
  function cleanup() {
    const timestamp = now();
    for (const [user, session] of sessions)
      if (session.expiresAt <= timestamp) sessions.delete(user);
    for (const [user, failure] of failures)
      if (failure.resetAt <= timestamp && failure.nextAt <= timestamp) failures.delete(user);
  }
  async function initialize(botClient) {
    client = botClient;
    cleanupTimer = setInterval(cleanup, 60_000);
    cleanupTimer.unref?.();
    if (!configured()) {
      console.log(
        '[Rules] Use /rules create role:@Verified in the combined Rules & Verification channel.',
      );
      return;
    }
    const channel = await client.channels.fetch(store.get().channelId);
    await validateChannel(channel);
    await validateRole(channel.guild, store.get().roleId);
    const panel = await findPanel(channel, store.get().panelMessageId);
    if (!panel) throw new Error('Rules panel was deleted. Use /rules create again.');
    console.log(`[Rules] Rules & Verification active in ${channel.id}.`);
  }
  async function execute(interaction) {
    if (!(await requireAdmin(interaction, guildId))) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'status') {
        const settings = store.get();
        await interaction.editReply({
          content: configured()
            ? `**Rules & Verification:** <#${settings.channelId}>\n**Role after captcha:** <@&${settings.roleId}>\n**Panel:** https://discord.com/channels/${guildId}/${settings.channelId}/${settings.panelMessageId}`
            : 'Not configured or disabled. Use `/rules create role:@Verified`.',
          allowedMentions: { parse: [] },
        });
        return;
      }
      if (setupInFlight) throw new Error('Rules setup is already running. Try again in a moment.');
      setupInFlight = true;
      try {
        if (subcommand === 'disable') {
          store.set({ ...store.get(), roleId: '' });
          sessions.clear();
          await interaction.editReply(
            '✅ New verifications disabled. Existing member roles remain unchanged.',
          );
          return;
        }
        const channel = interaction.options.getChannel('channel') ?? interaction.channel;
        const role = interaction.options.getRole('role', true);
        await validateChannel(channel);
        await validateRole(interaction.guild, role.id);
        const previous = store.get();
        const existing =
          previous.channelId === channel.id
            ? await findPanel(channel, previous.panelMessageId)
            : null;
        const payload = buildRulesPayload(interaction.guild);
        const panel = existing
          ? await existing.edit({ ...payload, attachments: [] })
          : await channel.send(payload);
        try {
          store.set({ guildId, channelId: channel.id, panelMessageId: panel.id, roleId: role.id });
        } catch (error) {
          if (!existing) await panel.delete().catch(console.error);
          throw error;
        }
        sessions.clear();
        if (previous.channelId && previous.channelId !== channel.id && previous.panelMessageId) {
          try {
            const oldChannel = await client.channels.fetch(previous.channelId);
            if (oldChannel?.guildId === guildId) {
              const oldPanel = await findPanel(oldChannel, previous.panelMessageId);
              if (oldPanel) await oldPanel.delete();
            }
          } catch (error) {
            console.error('[Rules] Could not remove the previous managed panel:', error);
          }
        }
        await interaction.editReply({
          content: `✅ Rules and verification combined in <#${channel.id}>.\nThe correct captcha grants <@&${role.id}>.\nGerman translation and private captcha are available from the same panel.`,
          allowedMentions: { parse: [] },
        });
      } finally {
        setupInFlight = false;
      }
    } catch (error) {
      console.error('[Rules] Setup failed:', error);
      await interaction.editReply({
        content: `❌ ${commandError(error)}`,
        allowedMentions: { parse: [] },
      });
    }
  }

  function validSource(interaction) {
    return (
      interaction.inGuild() &&
      interaction.guildId === guildId &&
      configured() &&
      interaction.channelId === store.get().channelId &&
      interaction.message?.author?.id === client?.user?.id &&
      Boolean(client?.user?.id)
    );
  }
  async function handleButton(interaction) {
    const language = interaction.customId.endsWith(':de') ? 'de' : 'en';
    const text = messages[language];
    if (!validSource(interaction)) {
      await interaction.reply({ content: text.disabled, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (interaction.customId.startsWith(LANGUAGE_PREFIX)) {
      await interaction.editReply(buildRulesPayload(interaction.guild, language));
      return;
    }
    const userId = interaction.user.id;
    if (starting.has(userId) || granting.has(userId)) {
      await interaction.editReply(text.busy);
      return;
    }
    starting.add(userId);
    try {
      cleanup();
      const snapshot = signature();
      const roleId = store.get().roleId;
      const member = await interaction.guild.members.fetch({ user: userId, force: true });
      if (member.user.bot) throw new Error('Bot accounts cannot use verification.');
      if (member.roles.cache.has(roleId)) {
        await interaction.editReply(text.already);
        return;
      }
      await validateRole(interaction.guild, roleId);
      const failure = failures.get(userId);
      if (failure && failure.nextAt > now()) {
        await interaction.editReply(text.cooldown(Math.ceil((failure.nextAt - now()) / 1000)));
        return;
      }
      let session = sessions.get(userId);
      if (!session || session.signature !== snapshot) {
        if (sessions.size + starting.size >= MAX_CHALLENGES)
          throw new Error('Verification is busy. Please try again shortly.');
        const challenge = await captchaFactory();
        if (snapshot !== signature() || !configured()) throw new Error(text.changed);
        session = {
          ...challenge,
          userId,
          roleId,
          language,
          signature: snapshot,
          expiresAt: now() + CAPTCHA_TTL_MS,
        };
        sessions.set(userId, session);
      }
      await interaction.editReply(buildCaptchaPayload(session));
    } catch (error) {
      console.error(`[Rules] Could not start verification for ${userId}:`, error);
      await interaction.editReply({
        content: `❌ ${commandError(error)}`,
        allowedMentions: { parse: [] },
      });
    } finally {
      starting.delete(userId);
    }
  }

  async function handleCaptcha(interaction) {
    const userId = interaction.user.id;
    const session = sessions.get(userId);
    const text = messages[session?.language ?? 'en'];
    if (!validSource(interaction)) {
      await interaction.reply({ content: text.disabled, flags: MessageFlags.Ephemeral });
      return;
    }
    const id = interaction.customId.slice(CAPTCHA_PREFIX.length);
    if (!session || session.id !== id) {
      await interaction.reply({ content: text.expired, flags: MessageFlags.Ephemeral });
      return;
    }

    sessions.delete(userId);
    await interaction.deferUpdate();
    if (session.expiresAt <= now()) {
      await interaction.editReply(statusPayload(text.expired));
      return;
    }
    if (session.signature !== signature()) {
      await interaction.editReply(statusPayload(text.changed));
      return;
    }
    if (interaction.values?.length !== 1 || interaction.values[0] !== session.correctValue) {
      const previous = failures.get(userId);
      const count = previous && previous.resetAt > now() ? previous.count + 1 : 1;
      failures.set(userId, {
        count,
        resetAt: now() + FAILURE_WINDOW_MS,
        nextAt: now() + (count >= 3 ? FAILURE_WINDOW_MS : 60_000),
      });
      await interaction.editReply(statusPayload(text.wrong));
      return;
    }
    if (granting.has(userId)) {
      await interaction.editReply(statusPayload(text.busy));
      return;
    }
    granting.add(userId);
    try {
      const member = await interaction.guild.members.fetch({ user: userId, force: true });
      const role = await validateRole(interaction.guild, session.roleId);
      if (session.signature !== signature() || !configured()) throw new Error(text.changed);
      if (!member.roles.cache.has(role.id))
        await member.roles.add(
          role.id,
          'S-Service: completed the member-bound verification captcha',
        );
      failures.delete(userId);
      await interaction.editReply(statusPayload(text.success));
    } catch (error) {
      console.error(`[Rules] Role grant failed for ${userId}:`, error);
      await interaction.editReply(statusPayload(`❌ ${commandError(error)}`));
    } finally {
      granting.delete(userId);
    }
  }

  function handlesInteraction(interaction) {
    return (
      (interaction.isButton() &&
        [VERIFY_PREFIX, LANGUAGE_PREFIX].some((prefix) =>
          interaction.customId.startsWith(prefix),
        )) ||
      (interaction.isStringSelectMenu() && interaction.customId.startsWith(CAPTCHA_PREFIX))
    );
  }
  return { data, initialize, execute, handlesInteraction, handleButton, handleCaptcha };
};

module.exports.buildRulesPayload = buildRulesPayload;
module.exports.buildCaptchaPayload = buildCaptchaPayload;
