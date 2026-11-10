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
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { loadJsonConfig } = require('../../core/json-config');
const settings = loadJsonConfig('honeypot');

const ACCENT_COLOR = 0xf91c2b;
const STATE_FILE = path.join(__dirname, '../../../data/honeypot.json');
const SNOWFLAKE = /^\d{17,20}$/;

module.exports = function createHoneypot({ guildId, enabled = true }) {
  const isEnabled = enabled !== false && settings.enabled !== false;
  const exemptRoleIds = [...new Set(settings.exemptRoleIds ?? [])];
  if (!exemptRoleIds.every((id) => typeof id === 'string' && SNOWFLAKE.test(id))) {
    throw new Error('Honeypot exemptRoleIds must contain Discord role IDs as strings.');
  }
  let state = { version: 1, guildId, channelId: null, panelMessageId: null, kicks: 0 };
  let client;
  let loaded = false;
  let enforcementReady = false;
  let panelQueue = Promise.resolve();
  const processingMembers = new Set();
  const recentKicks = new Map();

  const data = [
    new SlashCommandBuilder()
      .setName('honeypot')
      .setDescription('Manage the S-Service anti-spam honeypot')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .setDMPermission(false)
      .addSubcommand((command) =>
        command
          .setName('setup')
          .setDescription('Activate the honeypot and post or update its warning panel')
          .addChannelOption((option) =>
            option
              .setName('channel')
              .setDescription('Honeypot channel (defaults to this channel)')
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(false),
          ),
      )
      .addSubcommand((command) =>
        command
          .setName('status')
          .setDescription('Show the honeypot channel, status and kick counter'),
      ),
  ];

  function readState() {
    if (loaded) return;
    try {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (
        saved.version !== 1 ||
        saved.guildId !== guildId ||
        !Number.isSafeInteger(saved.kicks) ||
        saved.kicks < 0 ||
        (saved.channelId !== null && !SNOWFLAKE.test(saved.channelId)) ||
        (saved.panelMessageId !== null && !SNOWFLAKE.test(saved.panelMessageId))
      ) {
        throw new Error(
          'Invalid honeypot state or a different server ID. The saved counter was not reset.',
        );
      }
      state = saved;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    loaded = true;
  }

  function persist(next) {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const temporary = `${STATE_FILE}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
      fs.renameSync(temporary, STATE_FILE);
      state = next;
    } finally {
      try {
        fs.unlinkSync(temporary);
      } catch (error) {
        if (error.code !== 'ENOENT')
          console.error('[Honeypot] Temporary state cleanup failed:', error);
      }
    }
  }

  function buildPanel() {
    const exceptions = [
      'Bot accounts',
      'Administrators',
      ...exemptRoleIds.map((id) => `<@&${id}>`),
    ];
    return new ContainerBuilder()
      .setAccentColor(ACCENT_COLOR)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('## ⛔ STOP – READ THIS FIRST!'),
      )
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '**📌 What is this channel for?**\n> This S-Service channel helps detect automated spam and compromised accounts. Do not send messages here.',
        ),
      )
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '**⚠️ If you send a message in this channel, you will be:**\n> Kicked from the server immediately.\n> Your message in this channel will be deleted.',
        ),
      )
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`**🛡️ Exceptions**\n> ${exceptions.join(' · ')}`),
      )
      .addSeparatorComponents(new SeparatorBuilder())
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('sservice:honeypot:kicks')
            .setLabel(`Kicks: ${state.kicks}`)
            .setEmoji('🥾')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        ),
      );
  }

  function panelPayload() {
    return {
      flags: MessageFlags.IsComponentsV2,
      components: [buildPanel()],
      allowedMentions: { parse: [] },
    };
  }

  function serializePanel(action) {
    const operation = panelQueue.then(action);
    panelQueue = operation.catch(() => {});
    return operation;
  }

  async function checkPermissions(channel) {
    if (channel?.type !== ChannelType.GuildText || channel.guildId !== guildId) {
      throw new Error('Choose a regular text channel on the configured S-Service server.');
    }
    const botMember = channel.guild.members.me ?? (await channel.guild.members.fetchMe());
    const channelPermissions = channel.permissionsFor(botMember);
    const required = ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageMessages'];
    const missing = required.filter((name) => !channelPermissions?.has(PermissionFlagsBits[name]));
    if (!botMember.permissions.has(PermissionFlagsBits.KickMembers)) missing.push('KickMembers');
    if (missing.length) throw new Error(`Missing bot permissions: ${missing.join(', ')}.`);
  }

  async function findPanel(channel, messageId) {
    if (!messageId) return null;
    try {
      const message = await channel.messages.fetch(messageId);
      if (message.author.id !== client.user.id)
        throw new Error('The saved honeypot panel does not belong to this bot.');
      return message;
    } catch (error) {
      if (Number(error.code) === 10008) return null;
      throw error;
    }
  }

  async function writePanel(channel) {
    const previous = { ...state };
    const panel =
      state.channelId === channel.id ? await findPanel(channel, state.panelMessageId) : null;
    if (panel) {
      await panel.edit(panelPayload());
      persist({ ...state });
    } else {
      const sent = await channel.send(panelPayload());
      try {
        persist({ ...state, channelId: channel.id, panelMessageId: sent.id });
      } catch (error) {
        await sent
          .delete()
          .catch((cleanup) => console.error('[Honeypot] Could not remove unsaved panel:', cleanup));
        throw error;
      }
    }
    if (previous.channelId && previous.channelId !== channel.id && previous.panelMessageId) {
      try {
        const oldChannel = await client.channels.fetch(previous.channelId);
        if (oldChannel?.guildId === guildId) {
          const oldPanel = await findPanel(oldChannel, previous.panelMessageId);
          if (oldPanel) await oldPanel.delete();
        }
      } catch (error) {
        console.error('[Honeypot] Could not remove the old warning panel:', error);
      }
    }
  }

  async function initialize(botClient) {
    client = botClient;
    if (!isEnabled) return;
    readState();
    if (!state.channelId) {
      console.log('[Honeypot] Not configured. Use /honeypot setup in the desired channel.');
      return;
    }
    await serializePanel(async () => {
      const channel = await client.channels.fetch(state.channelId);
      await checkPermissions(channel);
      await writePanel(channel);
      enforcementReady = true;
    });
    console.log(`[Honeypot] Active in ${state.channelId}; successful kicks: ${state.kicks}.`);
  }

  async function execute(interaction) {
    if (!isEnabled) return;
    if (
      !interaction.inGuild() ||
      interaction.guildId !== guildId ||
      !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    ) {
      await interaction.reply({
        content: '❌ Only server administrators can manage the honeypot.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      readState();
      if (interaction.options.getSubcommand() === 'status') {
        await interaction.editReply({
          content: [
            '**🛡️ S-Service Honeypot**',
            `**Status:** ${enforcementReady ? 'Active' : 'Inactive'}`,
            `**Channel:** ${state.channelId ? `<#${state.channelId}>` : 'Not configured — use /honeypot setup'}`,
            `**Successful kicks:** ${state.kicks}`,
            `**Log channel:** ${settings.logChannelId ? `<#${settings.logChannelId}>` : 'Not configured'}`,
            '**Exceptions:** Bot accounts · Administrators' +
              exemptRoleIds.map((id) => ` · <@&${id}>`).join(''),
          ].join('\n'),
          allowedMentions: { parse: [] },
        });
        return;
      }
      const channel = interaction.options.getChannel('channel') ?? interaction.channel;
      await checkPermissions(channel);
      await serializePanel(async () => {
        await writePanel(channel);
        enforcementReady = true;
      });
      await interaction.editReply({
        content: `✅ S-Service honeypot activated in ${channel}. Non-exempt members who send a message there will be kicked and their message deleted.`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error('[Honeypot] Command failed:', error);
      await interaction.editReply({
        content: `❌ ${String(error.message).slice(0, 1500)}`,
        allowedMentions: { parse: [] },
      });
    }
  }

  async function logEvent(member, successful, detail) {
    console[successful ? 'log' : 'error'](
      `[Honeypot] ${successful ? 'Kicked' : 'Could not kick'} ${member.id}: ${detail}`,
    );
    if (!settings.logChannelId) return;
    try {
      const channel = await client.channels.fetch(settings.logChannelId);
      if (!channel?.isTextBased() || channel.guildId !== guildId)
        throw new Error('Invalid honeypot log channel.');
      await channel.send({
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
        components: [
          new ContainerBuilder()
            .setAccentColor(ACCENT_COLOR)
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(
                successful
                  ? '## 🥾 S-Service Honeypot — Kick'
                  : '## ⚠️ S-Service Honeypot — Kick failed',
              ),
            )
            .addSeparatorComponents(new SeparatorBuilder())
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(
                [
                  `**Member:** <@${member.id}> (\`${member.id}\`)`,
                  `**Channel:** <#${state.channelId}>`,
                  `**Result:** ${detail}`,
                  `**Successful kicks:** ${state.kicks}`,
                  `**Time:** <t:${Math.floor(Date.now() / 1000)}:F>`,
                ].join('\n'),
              ),
            ),
        ],
      });
    } catch (error) {
      console.error('[Honeypot] Could not send moderation log:', error);
    }
  }

  async function deleteMessage(message) {
    try {
      await message.delete();
      return true;
    } catch (error) {
      if (Number(error.code) !== 10008)
        console.error('[Honeypot] Could not delete triggering message:', error);
      return Number(error.code) === 10008;
    }
  }

  async function handleMessage(message) {
    if (
      !isEnabled ||
      !enforcementReady ||
      !message.inGuild() ||
      message.guildId !== guildId ||
      message.channelId !== state.channelId
    )
      return false;
    if (message.author.bot) return true;
    const now = Date.now();
    for (const [id, timestamp] of recentKicks) if (now - timestamp > 60_000) recentKicks.delete(id);
    if (processingMembers.has(message.author.id) || recentKicks.has(message.author.id)) {
      await deleteMessage(message);
      return true;
    }
    let member;
    try {
      member = await message.guild.members.fetch({ user: message.author.id, force: true });
    } catch (error) {
      if (Number(error.code) !== 10007)
        console.error('[Honeypot] Could not verify member exemptions; no kick attempted:', error);
      return true;
    }
    if (
      member.id === message.guild.ownerId ||
      member.permissions.has(PermissionFlagsBits.Administrator) ||
      exemptRoleIds.some((id) => member.roles.cache.has(id))
    )
      return true;
    if (!enforcementReady || message.channelId !== state.channelId) return true;
    if (processingMembers.has(member.id) || recentKicks.has(member.id)) {
      await deleteMessage(message);
      return true;
    }
    processingMembers.add(member.id);
    try {
      const messageDeleted = await deleteMessage(message);
      if (!enforcementReady || message.channelId !== state.channelId) return true;
      if (!member.kickable) {
        await logEvent(
          member,
          false,
          'Check Kick Members permission and move the bot role above this member.',
        );
        return true;
      }
      try {
        await member.kick(`S-Service Honeypot: posted in channel ${state.channelId}.`);
      } catch (error) {
        await logEvent(
          member,
          false,
          `Discord rejected the kick (${error.code ?? 'unknown error'}).`,
        );
        return true;
      }
      recentKicks.set(member.id, Date.now());
      const next = { ...state, kicks: state.kicks + 1 };
      try {
        persist(next);
      } catch (error) {
        state = next;
        console.error('[Honeypot] Kick succeeded, but the counter could not be saved:', error);
      }
      await serializePanel(async () => {
        const channel = await client.channels.fetch(state.channelId);
        await writePanel(channel);
      }).catch((error) =>
        console.error('[Honeypot] Could not update the warning panel counter:', error),
      );
      await logEvent(
        member,
        true,
        messageDeleted
          ? 'Posted in the honeypot channel. Message deleted.'
          : 'Kick succeeded, but the message could not be deleted. Check Manage Messages permission.',
      );
    } finally {
      processingMembers.delete(member.id);
    }
    return true;
  }

  return { enabled: isEnabled, data, initialize, execute, handleMessage };
};
