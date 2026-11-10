const fs = require('node:fs');
const path = require('node:path');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ChannelType,
  MessageType,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  AttachmentBuilder,
} = require('discord.js');
const { createStore, requireAdmin, requirePermissions, commandError } = require('../core/utils');

const BOOST_TYPES = new Set([
  MessageType.GuildBoost,
  MessageType.GuildBoostTier1,
  MessageType.GuildBoostTier2,
  MessageType.GuildBoostTier3,
]);
const ACCENT_COLOR = 0xf91c2b;
const BANNER_PATH = path.join(__dirname, '../../assets/banner_booster.png');
const FALLBACK_DELAY_MS = 8000;
const CORRELATION_MS = 30_000;
const SEEN_MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;

function buildBoostPayload(
  guild,
  user,
  { member = null, notify = true, timestamp = Date.now() } = {},
) {
  const receivedAt = Math.floor(
    (Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now()) / 1000,
  );
  const panel = new ContainerBuilder()
    .setAccentColor(ACCENT_COLOR)
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL('attachment://banner_booster.png')
          .setDescription('S-Service — Booster'),
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('## 🚀 Thanks for the boost!'),
          new TextDisplayBuilder().setContent(
            `**<@${user.id}> just boosted S-Service.**\nA little boost. A big difference for our community.`,
          ),
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL((member ?? user).displayAvatarURL({ size: 256 }))
            .setDescription('Our server booster'),
        ),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          '### ❤️ Powered by our community',
          '> Thank you for backing S-Service and helping our community grow.',
          '> Your support means a lot — we are glad to have you with us.',
        ].join('\n'),
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# S-Service • Community powered. • <t:${receivedAt}:f>`,
      ),
    );
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [panel],
    files: [new AttachmentBuilder(BANNER_PATH, { name: 'banner_booster.png' })],
    allowedMentions: { parse: [], users: notify ? [user.id] : [] },
  };
}

module.exports = function createBooster({
  guildId,
  statePath = path.join(__dirname, '../../data/booster.json'),
  now = Date.now,
}) {
  const store = createStore(statePath, { guildId, channelId: '' });
  const seenMessages = new Map();
  const recentSystems = new Map();
  const fallbackSent = new Map();
  const pendingFallbacks = new Map();
  const seenTransitions = new Map();
  let client;
  let revision = 0;
  const data = [
    new SlashCommandBuilder()
      .setName('booster')
      .setDescription('Manage S-Service server boost messages')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .setDMPermission(false)
      .addSubcommand((sub) =>
        sub
          .setName('setup')
          .setDescription('Choose the channel for automatic boost messages')
          .addChannelOption((option) =>
            option
              .setName('channel')
              .setDescription('Booster messages are sent here')
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub.setName('test').setDescription('Send a booster preview for yourself'),
      )
      .addSubcommand((sub) =>
        sub.setName('status').setDescription('Show the current booster channel'),
      )
      .addSubcommand((sub) =>
        sub.setName('disable').setDescription('Disable automatic booster messages'),
      ),
  ];

  function configured() {
    const settings = store.get();
    return settings.guildId === guildId && Boolean(settings.channelId);
  }
  async function validateChannel(channel) {
    if (channel?.guildId !== guildId || channel.type !== ChannelType.GuildText)
      throw new Error('Choose a text channel on the S-Service server.');
    await requirePermissions(channel, ['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles']);
    fs.accessSync(BANNER_PATH, fs.constants.R_OK);
  }
  function cleanup() {
    const timestamp = now();
    for (const [id, at] of seenMessages)
      if (timestamp - at > SEEN_MESSAGE_TTL_MS) seenMessages.delete(id);
    while (seenMessages.size > 10_000) seenMessages.delete(seenMessages.keys().next().value);
    for (const map of [recentSystems, fallbackSent]) {
      for (const [id, item] of map) if (timestamp - item.at > CORRELATION_MS) map.delete(id);
    }
    for (const [key, at] of seenTransitions)
      if (timestamp - at > SEEN_MESSAGE_TTL_MS) seenTransitions.delete(key);
  }
  function cancelPending() {
    for (const item of pendingFallbacks.values()) clearTimeout(item.timer);
    pendingFallbacks.clear();
  }
  async function sendBoost(guild, user, options = {}, expectedRevision = revision) {
    if (!configured() || expectedRevision !== revision) return false;
    const channel = await client.channels.fetch(store.get().channelId);
    await validateChannel(channel);
    if (!configured() || expectedRevision !== revision) return false;
    await channel.send(buildBoostPayload(guild, user, options));
    return true;
  }
  function handleMemberUpdate(oldMember, newMember) {
    if (
      !configured() ||
      newMember.guild.id !== guildId ||
      newMember.user.bot ||
      oldMember.partial ||
      oldMember.premiumSinceTimestamp !== null ||
      !newMember.premiumSinceTimestamp
    )
      return;
    cleanup();
    const key = `${newMember.id}:${newMember.premiumSinceTimestamp}`;
    if (seenTransitions.has(key) || pendingFallbacks.has(newMember.id)) return;
    seenTransitions.set(key, now());
    if (recentSystems.has(newMember.id)) return;
    const targetRevision = revision;
    const timer = setTimeout(async () => {
      pendingFallbacks.delete(newMember.id);
      if (!configured() || targetRevision !== revision || !newMember.premiumSinceTimestamp) return;

      const marker = { at: now(), matched: false, promise: null };
      fallbackSent.set(newMember.id, marker);
      marker.promise = (async () => {
        try {
          const sent = await sendBoost(
            newMember.guild,
            newMember.user,
            {
              member: newMember,
              timestamp: newMember.premiumSinceTimestamp,
            },
            targetRevision,
          );
          if (!sent && fallbackSent.get(newMember.id) === marker) fallbackSent.delete(newMember.id);
          return sent;
        } catch (error) {
          if (fallbackSent.get(newMember.id) === marker) fallbackSent.delete(newMember.id);
          seenTransitions.delete(key);
          console.error('[Booster] Could not send boost notification:', error);
          return false;
        }
      })();
      await marker.promise;
    }, FALLBACK_DELAY_MS);
    timer.unref?.();
    pendingFallbacks.set(newMember.id, { timer });
  }
  function handleStop(oldMember, newMember) {
    if (
      newMember.guild.id !== guildId ||
      !oldMember.premiumSinceTimestamp ||
      newMember.premiumSinceTimestamp
    )
      return;
    const pending = pendingFallbacks.get(newMember.id);
    if (pending) clearTimeout(pending.timer);
    pendingFallbacks.delete(newMember.id);
    recentSystems.delete(newMember.id);
    fallbackSent.delete(newMember.id);
  }
  function handleUpdate(oldMember, newMember) {
    handleStop(oldMember, newMember);
    handleMemberUpdate(oldMember, newMember);
  }
  async function handleMessage(message) {
    if (message.guildId !== guildId || !BOOST_TYPES.has(message.type)) return false;

    if (!configured() || !message.author || message.author.bot) return true;
    cleanup();
    if (seenMessages.has(message.id)) return true;
    seenMessages.set(message.id, now());
    const userId = message.author.id;
    recentSystems.set(userId, { at: now() });
    const pending = pendingFallbacks.get(userId);
    if (pending) clearTimeout(pending.timer);
    pendingFallbacks.delete(userId);
    const fallback = fallbackSent.get(userId);
    if (fallback && !fallback.matched) {
      fallback.matched = true;
      if (await fallback.promise) return true;
    }
    try {
      await sendBoost(message.guild, message.author, {
        member: message.member,
        timestamp: message.createdTimestamp ?? now(),
      });
    } catch (error) {
      seenMessages.delete(message.id);
      recentSystems.delete(userId);
      console.error('[Booster] Could not send boost notification:', error);
    }
    return true;
  }
  async function initialize(botClient) {
    client = botClient;
    client.on('guildMemberUpdate', handleUpdate);
    if (!configured()) {
      console.log('[Booster] Use /booster setup to choose the boost notification channel.');
      return;
    }
    await validateChannel(await client.channels.fetch(store.get().channelId));
    console.log(`[Booster] Active in ${store.get().channelId}.`);
  }
  async function execute(interaction) {
    if (!(await requireAdmin(interaction, guildId))) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'setup') {
        const channel = interaction.options.getChannel('channel', true);
        await validateChannel(channel);
        store.set({ guildId, channelId: channel.id });
        revision++;
        cancelPending();
        recentSystems.clear();
        fallbackSent.clear();
        await interaction.editReply({
          content: `✅ S-Service boost messages enabled in <#${channel.id}>. Use \`/booster test\` for a preview.`,
          allowedMentions: { parse: [] },
        });
        return;
      }
      if (subcommand === 'disable') {
        store.set({ guildId, channelId: '' });
        revision++;
        cancelPending();
        recentSystems.clear();
        fallbackSent.clear();
        await interaction.editReply('✅ Automatic booster messages disabled.');
        return;
      }
      if (!configured())
        throw new Error('Booster messages are not configured. Use /booster setup first.');
      if (subcommand === 'test') {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        await sendBoost(interaction.guild, interaction.user, { member, notify: false });
        await interaction.editReply({
          content: `✅ Booster preview sent to <#${store.get().channelId}>.`,
          allowedMentions: { parse: [] },
        });
        return;
      }
      await interaction.editReply({
        content: `**Booster channel:** <#${store.get().channelId}>\n**Style:** Welcome card layout · red booster banner · avatar · timestamp\n**Detection:** Discord boost messages with a fallback for new boosters.`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error('[Booster] Command failed:', error);
      await interaction.editReply({
        content: `❌ ${commandError(error)}`,
        allowedMentions: { parse: [] },
      });
    }
  }
  return { data, initialize, execute, handleMessage };
};

module.exports.buildBoostPayload = buildBoostPayload;
