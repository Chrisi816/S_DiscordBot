const fs = require('node:fs');
const path = require('node:path');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ChannelType,
  AttachmentBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { createStore, requireAdmin, requirePermissions, commandError } = require('../core/utils');

const ACCENT_COLOR = 0xf91c2b;
const BANNER_PATH = path.join(__dirname, '../../assets/banner_welcome.png');

function discordTimestamp(milliseconds, style) {
  return Number.isFinite(milliseconds) && milliseconds > 0
    ? `<t:${Math.floor(milliseconds / 1000)}:${style}>`
    : 'Unavailable';
}

function buildWelcomePayload(member, settings, { notify = true } = {}) {
  const channelURL = (channelId) => `https://discord.com/channels/${member.guild.id}/${channelId}`;
  const panel = new ContainerBuilder()
    .setAccentColor(ACCENT_COLOR)
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL('attachment://banner_welcome.png')
          .setDescription('S-Service — Welcome'),
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('## 👋 Welcome to S-Service'),
          new TextDisplayBuilder().setContent(
            `**Good to have you here, <@${member.id}>.**\nFiveM scripts, fresh ideas and a community that builds. Make yourself at home.`,
          ),
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(member.displayAvatarURL({ size: 256 }))
            .setDescription('New member avatar'),
        ),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          '### 🚀 Your next upgrade starts here',
          `> Catch new releases and changelogs in <#${settings.announcementsChannelId}>.`,
          '> Explore our scripts, find your next upgrade and share what you create.',
        ].join('\n'),
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          '### 🛠️ Need a hand with your setup?',
          '> From questions before a purchase to help with your scripts, our team is here for you.',
          `> Head to <#${settings.ticketChannelId}> and open the ticket that fits your request.`,
        ].join('\n'),
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          '**👤 Your community profile**',
          `> **Joined S-Service:** ${discordTimestamp(member.joinedTimestamp, 'f')}`,
          `> **On Discord since:** ${discordTimestamp(member.user.createdTimestamp, 'D')} · ${discordTimestamp(member.user.createdTimestamp, 'R')}`,
        ].join('\n'),
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Latest releases')
          .setEmoji('🚀')
          .setStyle(ButtonStyle.Link)
          .setURL(channelURL(settings.announcementsChannelId)),
        new ButtonBuilder()
          .setLabel('Contact support')
          .setEmoji('🎫')
          .setStyle(ButtonStyle.Link)
          .setURL(channelURL(settings.ticketChannelId)),
      ),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('-# S-Service • Built for your next server upgrade.'),
    );
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [panel],
    files: [new AttachmentBuilder(BANNER_PATH, { name: 'banner_welcome.png' })],
    allowedMentions: { parse: [], users: notify ? [member.id] : [] },
  };
}

module.exports = function createWelcome({
  guildId,
  statePath = path.join(__dirname, '../../data/welcome.json'),
}) {
  const store = createStore(statePath, {
    guildId,
    channelId: '',
    announcementsChannelId: '',
    ticketChannelId: '',
  });
  const recentWelcomes = new Map();
  let setupInFlight = false;
  const data = [
    new SlashCommandBuilder()
      .setName('welcome')
      .setDescription('Configure S-Service welcome messages')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .setDMPermission(false)
      .addSubcommand((sub) =>
        sub
          .setName('setup')
          .setDescription('Enable welcome messages in a channel')
          .addChannelOption((option) =>
            option
              .setName('channel')
              .setDescription('Welcome messages are sent here')
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true),
          )
          .addChannelOption((option) =>
            option
              .setName('announcements')
              .setDescription('Channel for script news')
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              .setRequired(true),
          )
          .addChannelOption((option) =>
            option
              .setName('ticket')
              .setDescription('Channel with the ticket panel')
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('test')
          .setDescription('Send a welcome preview for yourself in the configured channel'),
      )
      .addSubcommand((sub) =>
        sub.setName('status').setDescription('Show the current welcome settings'),
      )
      .addSubcommand((sub) =>
        sub.setName('disable').setDescription('Disable automatic welcome messages'),
      ),
  ];

  function configured() {
    const settings = store.get();
    return (
      settings.guildId === guildId &&
      settings.channelId &&
      settings.announcementsChannelId &&
      settings.ticketChannelId
    );
  }

  async function validateChannel(channel) {
    if (channel?.guildId !== guildId || channel.type !== ChannelType.GuildText) {
      throw new Error(
        'Choose a regular text channel on the S-Service server for welcome messages.',
      );
    }
    await requirePermissions(channel, ['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles']);
    fs.accessSync(BANNER_PATH, fs.constants.R_OK);
  }

  async function sendWelcome(member, notify = true, settings = store.get()) {
    const channel = await member.guild.channels.fetch(settings.channelId);
    await validateChannel(channel);
    await channel.send(buildWelcomePayload(member, settings, { notify }));
  }

  async function handleJoin(member) {
    if (member.guild.id !== guildId || member.user.bot || !configured()) return;

    const now = Date.now();
    for (const [id, item] of recentWelcomes)
      if (now - item.at > 5 * 60 * 1000) recentWelcomes.delete(id);
    const join = member.joinedTimestamp ?? 0;
    if (recentWelcomes.get(member.id)?.join === join) return;
    recentWelcomes.set(member.id, { join, at: now });
    try {
      await sendWelcome(member);
    } catch (error) {
      recentWelcomes.delete(member.id);
      console.error(`[Welcome] Could not welcome ${member.id}:`, error);
    }
  }

  async function initialize(client) {
    client.on('guildMemberAdd', handleJoin);
    client.on('guildMemberRemove', (member) => {
      if (member.guild.id === guildId) recentWelcomes.delete(member.id);
    });
    if (!configured()) {
      console.log(
        '[Welcome] Use /welcome setup to select the welcome, announcements and ticket channels.',
      );
      return;
    }
    await validateChannel(await client.channels.fetch(store.get().channelId));
    console.log(`[Welcome] Active in ${store.get().channelId}.`);
  }

  async function execute(interaction) {
    if (!(await requireAdmin(interaction, guildId))) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'setup') {
        if (setupInFlight)
          throw new Error('Welcome setup is already running. Try again in a moment.');
        setupInFlight = true;
        try {
          const channel = interaction.options.getChannel('channel', true);
          const announcements = interaction.options.getChannel('announcements', true);
          const ticket = interaction.options.getChannel('ticket', true);
          await validateChannel(channel);
          for (const linked of [announcements, ticket]) {
            if (
              linked.guildId !== guildId ||
              ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(linked.type)
            ) {
              throw new Error('Select text channels on the S-Service server for the links.');
            }
            await requirePermissions(linked, ['ViewChannel']);
          }
          store.set({
            guildId,
            channelId: channel.id,
            announcementsChannelId: announcements.id,
            ticketChannelId: ticket.id,
          });
          await interaction.editReply({
            content: `✅ S-Service welcome messages enabled in <#${channel.id}>.\nRed welcome card with your banner, member profile and quick links to <#${announcements.id}> and <#${ticket.id}>.\nUse \`/welcome test\` to send a preview.`,
            allowedMentions: { parse: [] },
          });
        } finally {
          setupInFlight = false;
        }
        return;
      }
      if (subcommand === 'disable') {
        if (setupInFlight) throw new Error('Welcome setup is running. Try again in a moment.');
        store.set({ ...store.get(), channelId: '' });
        await interaction.editReply('✅ Automatic welcome messages disabled.');
        return;
      }
      if (!configured())
        throw new Error('Welcome messages are not configured. Use /welcome setup first.');
      if (subcommand === 'test') {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        await sendWelcome(member, false);
        await interaction.editReply({
          content: `✅ Welcome preview sent to <#${store.get().channelId}>.`,
          allowedMentions: { parse: [] },
        });
        return;
      }
      const settings = store.get();
      await interaction.editReply({
        content: `**Welcome channel:** <#${settings.channelId}>\n**Announcements:** <#${settings.announcementsChannelId}>\n**Ticket panel:** <#${settings.ticketChannelId}>\n**Design:** S-Service red · banner first · member profile · quick links`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error('[Welcome] Command failed:', error);
      await interaction.editReply({
        content: `❌ ${commandError(error)}`,
        allowedMentions: { parse: [] },
      });
    }
  }

  return { data, initialize, execute };
};

module.exports.buildWelcomePayload = buildWelcomePayload;
