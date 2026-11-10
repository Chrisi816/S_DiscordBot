const fs = require('node:fs');
const path = require('node:path');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ChannelType,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  TextDisplayBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { createStore, requireAdmin, requirePermissions, commandError } = require('../core/utils');
const defaultLinks = require('../../config/socials.json');
const content = require('./socials-content');

const BANNER_PATH = path.join(__dirname, '../../assets/banner_socials.png');
const LANGUAGE_PREFIX = 'sservice:socials:language:';
const PLATFORMS = [
  { key: 'tebex', emoji: '🛒' },
  { key: 'youtube', emoji: '▶️' },
  { key: 'tiktok', emoji: '🎵' },
  { key: 'docs', emoji: '📚' },
];

function validateLinks(links) {
  const result = {};
  for (const { key } of PLATFORMS) {
    try {
      if (typeof links[key] !== 'string' || !links[key].trim() || links[key].length > 512)
        throw new Error();
      const url = new URL(links[key].trim());
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
      result[key] = url.href;
    } catch {
      throw new Error(`Configure a valid HTTPS ${key} URL in config/socials.json.`);
    }
  }
  return result;
}

function buildSocialsPayload(guild, links = defaultLinks, language = 'en') {
  const lang = language === 'de' ? 'de' : 'en';
  const text = content[lang];
  const urls = validateLinks(links);
  const panel = new ContainerBuilder()
    .setAccentColor(0xf91c2b)
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL('attachment://banner_socials.png')
          .setDescription('S-Service — Socials'),
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder());
  const title = new TextDisplayBuilder().setContent(text.title);
  const intro = new TextDisplayBuilder().setContent(text.intro);
  const iconURL = guild.iconURL({ size: 128 });
  if (iconURL)
    panel.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(title, intro)
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(iconURL).setDescription('S-Service')),
    );
  else panel.addTextDisplayComponents(title, intro);
  for (const section of text.sections) {
    panel
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${section.heading}\n${section.description}`),
      );
  }
  panel
    .addSeparatorComponents(new SeparatorBuilder())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        PLATFORMS.map(({ key, emoji }) =>
          new ButtonBuilder()
            .setLabel(text.labels[key])
            .setEmoji(emoji)
            .setStyle(ButtonStyle.Link)
            .setURL(urls[key]),
        ),
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${LANGUAGE_PREFIX}${lang === 'de' ? 'en' : 'de'}`)
          .setLabel(text.languageLabel)
          .setEmoji(text.languageEmoji)
          .setStyle(ButtonStyle.Secondary),
      ),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text.footer));
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [panel],
    files: [new AttachmentBuilder(BANNER_PATH, { name: 'banner_socials.png' })],
    allowedMentions: { parse: [] },
  };
}

module.exports = function createSocials({
  guildId,
  statePath = path.join(__dirname, '../../data/socials.json'),
  links = defaultLinks,
}) {
  const store = createStore(statePath, { guildId, channelId: '', panelMessageId: '' });
  let client;
  let setupInFlight = false;
  const data = [
    new SlashCommandBuilder()
      .setName('socials')
      .setDescription('Manage the S-Service Socials panel')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .setDMPermission(false)
      .addSubcommand((sub) =>
        sub
          .setName('create')
          .setDescription('Post or update the Socials panel in the Welcome design')
          .addChannelOption((option) =>
            option
              .setName('channel')
              .setDescription('Socials channel; defaults to this channel')
              .addChannelTypes(ChannelType.GuildText),
          ),
      )
      .addSubcommand((sub) =>
        sub.setName('status').setDescription('Show the Socials panel and configured links'),
      ),
  ];

  function configured() {
    const settings = store.get();
    return settings.guildId === guildId && settings.channelId && settings.panelMessageId;
  }
  async function validateChannel(channel) {
    if (channel?.guildId !== guildId || channel.type !== ChannelType.GuildText)
      throw new Error('Choose a text channel on the S-Service server.');
    await requirePermissions(channel, [
      'ViewChannel',
      'SendMessages',
      'ReadMessageHistory',
      'EmbedLinks',
      'AttachFiles',
    ]);
    fs.accessSync(BANNER_PATH, fs.constants.R_OK);
  }
  async function findPanel(channel, messageId) {
    if (!messageId) return null;
    try {
      const message = await channel.messages.fetch(messageId);
      if (message.author.id !== client.user.id)
        throw new Error('The saved Socials panel belongs to a different bot.');
      return message;
    } catch (error) {
      if (error.code === 10008) return null;
      throw error;
    }
  }
  async function initialize(botClient) {
    client = botClient;
    validateLinks(links);
    if (!configured()) {
      console.log('[Socials] Use /socials create in the desired Socials channel.');
      return;
    }
    const settings = store.get();
    const channel = await client.channels.fetch(settings.channelId);
    await validateChannel(channel);
    if (!(await findPanel(channel, settings.panelMessageId)))
      throw new Error('Socials panel was deleted. Use /socials create again.');
    console.log(`[Socials] Active in ${settings.channelId}.`);
  }
  async function execute(interaction) {
    if (!(await requireAdmin(interaction, guildId))) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const urls = validateLinks(links);
      if (interaction.options.getSubcommand() === 'status') {
        const settings = store.get();
        await interaction.editReply({
          content: [
            configured()
              ? `**Socials channel:** <#${settings.channelId}>\n**Panel:** https://discord.com/channels/${guildId}/${settings.channelId}/${settings.panelMessageId}`
              : 'Not configured. Use `/socials create`.',
            ...PLATFORMS.map(({ key }) => `**${content.en.labels[key]}:** ${urls[key]}`),
          ].join('\n'),
          allowedMentions: { parse: [] },
        });
        return;
      }
      if (setupInFlight) throw new Error('Socials setup is already running. Please wait a moment.');
      setupInFlight = true;
      try {
        const channel = interaction.options.getChannel('channel') ?? interaction.channel;
        await validateChannel(channel);
        const previous = store.get();
        const existing =
          previous.guildId === guildId && previous.channelId === channel.id
            ? await findPanel(channel, previous.panelMessageId)
            : null;
        const payload = buildSocialsPayload(interaction.guild, urls);
        const panel = existing
          ? await existing.edit({ ...payload, attachments: [] })
          : await channel.send(payload);
        try {
          store.set({ guildId, channelId: channel.id, panelMessageId: panel.id });
        } catch (error) {
          if (!existing) await panel.delete().catch(console.error);
          throw error;
        }
        if (
          previous.guildId === guildId &&
          previous.channelId &&
          previous.channelId !== channel.id &&
          previous.panelMessageId
        ) {
          try {
            const oldChannel = await client.channels.fetch(previous.channelId);
            if (oldChannel?.guildId === guildId) {
              const oldPanel = await findPanel(oldChannel, previous.panelMessageId);
              if (oldPanel) await oldPanel.delete();
            }
          } catch (error) {
            console.error('[Socials] Could not remove the previous managed panel:', error);
          }
        }
        await interaction.editReply({
          content: `✅ S-Service Socials panel posted in <#${channel.id}>.\nTebex · YouTube · TikTok · Documentation · private German translation.\nEdit links in \`config/socials.json\`, restart and run \`/socials create\` in this channel again to update the panel.`,
          allowedMentions: { parse: [] },
        });
      } finally {
        setupInFlight = false;
      }
    } catch (error) {
      console.error('[Socials] Command failed:', error);
      await interaction.editReply({
        content: `❌ ${commandError(error)}`,
        allowedMentions: { parse: [] },
      });
    }
  }
  async function handleButton(interaction) {
    if (
      !interaction.inGuild() ||
      interaction.guildId !== guildId ||
      !configured() ||
      interaction.channelId !== store.get().channelId ||
      !client?.user?.id ||
      interaction.message?.author?.id !== client.user.id
    ) {
      await interaction.reply({
        content: 'This Socials panel is not active here. Ask the team to run /socials create.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const language = interaction.customId === `${LANGUAGE_PREFIX}de` ? 'de' : 'en';
      await interaction.editReply(buildSocialsPayload(interaction.guild, links, language));
    } catch (error) {
      console.error('[Socials] Translation failed:', error);
      await interaction.editReply({
        content: `❌ ${commandError(error)}`,
        allowedMentions: { parse: [] },
      });
    }
  }
  function handlesInteraction(interaction) {
    return (
      interaction.isButton() &&
      [`${LANGUAGE_PREFIX}en`, `${LANGUAGE_PREFIX}de`].includes(interaction.customId)
    );
  }
  return { data, initialize, execute, handlesInteraction, handleButton };
};

module.exports.buildSocialsPayload = buildSocialsPayload;
module.exports.validateLinks = validateLinks;
