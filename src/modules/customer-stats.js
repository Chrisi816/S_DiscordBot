const path = require('node:path');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ChannelType,
} = require('discord.js');
const { createStore, requireAdmin, requirePermissions, commandError } = require('../core/utils');

const RENAME_INTERVAL_MS = 6 * 60 * 1000;
const RECONCILE_INTERVAL_MS = 15 * 60 * 1000;
const channelName = (count) => `💥︲Customers: ${count}`;

module.exports = function createCustomerStats({
  guildId,
  statePath = path.join(__dirname, '../../data/customer-stats.json'),
}) {
  const store = createStore(statePath, { guildId, roleId: '', channelId: '' });
  let client;
  let customers = new Set();
  let snapshotReady = false;
  let syncPromise = null;
  let renameTimer = null;
  let reconcileTimer = null;
  let renameInFlight = false;
  let setupInFlight = false;
  let lastRename = 0;
  let revision = 0;

  const data = [
    new SlashCommandBuilder()
      .setName('customerstats')
      .setDescription('Configure the S-Service customer counter')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .setDMPermission(false)
      .addSubcommand((sub) =>
        sub
          .setName('setup')
          .setDescription('Count members with a role in a voice channel')
          .addRoleOption((option) =>
            option.setName('role').setDescription('Customer role to count').setRequired(true),
          )
          .addChannelOption((option) =>
            option
              .setName('channel')
              .setDescription('Existing voice channel; leave empty to create one')
              .addChannelTypes(ChannelType.GuildVoice),
          )
          .addChannelOption((option) =>
            option
              .setName('category')
              .setDescription('Category for a newly created counter')
              .addChannelTypes(ChannelType.GuildCategory),
          ),
      )
      .addSubcommand((sub) =>
        sub.setName('status').setDescription('Show the customer role, counter and current count'),
      ),
  ];

  function configured() {
    const settings = store.get();
    return settings.guildId === guildId && settings.roleId && settings.channelId;
  }

  function scheduleUpdate() {
    if (!configured() || !snapshotReady || renameInFlight || renameTimer) return;
    const delay = Math.max(2000, lastRename + RENAME_INTERVAL_MS - Date.now());
    renameTimer = setTimeout(() => {
      renameTimer = null;
      updateChannel().catch((error) => console.error('[CustomerStats] Update failed:', error));
    }, delay);
    renameTimer.unref?.();
  }

  async function updateChannel() {
    if (!configured() || !snapshotReady || renameInFlight) return;
    if (Date.now() < lastRename + RENAME_INTERVAL_MS) {
      scheduleUpdate();
      return;
    }
    renameInFlight = true;
    const settings = store.get();
    const targetRevision = revision;
    const targetName = channelName(customers.size);
    try {
      const channel = await client.channels.fetch(settings.channelId);
      if (channel?.guildId !== guildId || channel.type !== ChannelType.GuildVoice) {
        throw new Error(
          'The configured counter must be a voice channel on the S-Service server. Run /customerstats setup again.',
        );
      }
      await requirePermissions(channel, ['ViewChannel', 'ManageChannels']);
      if (targetRevision !== revision) return;
      if (channel.name !== targetName) {
        lastRename = Date.now();
        await channel.setName(targetName, 'S-Service customer role count');
      }
    } finally {
      renameInFlight = false;
      if (targetRevision !== revision || targetName !== channelName(customers.size))
        scheduleUpdate();
    }
  }

  async function resync() {
    if (!configured()) return;
    if (syncPromise) return syncPromise;
    const settings = store.get();
    const targetRevision = revision;
    syncPromise = (async () => {
      const guild = await client.guilds.fetch(guildId);
      const role = await guild.roles.fetch(settings.roleId);
      if (!role) throw new Error('Customer role no longer exists. Run /customerstats setup again.');

      await guild.members.fetch();
      if (targetRevision !== revision) return;
      customers = new Set(role.members.keys());
      snapshotReady = true;
      await updateChannel();
    })();
    try {
      await syncPromise;
    } finally {
      syncPromise = null;
    }
  }

  function handleMember(member) {
    if (member.guild.id !== guildId || !configured() || !snapshotReady) return;
    const { roleId } = store.get();
    const previousCount = customers.size;
    if (member.roles.cache.has(roleId)) customers.add(member.id);
    else customers.delete(member.id);
    if (previousCount !== customers.size) scheduleUpdate();
  }

  function handleRemove(member) {
    if (member.guild.id === guildId && customers.delete(member.id)) scheduleUpdate();
  }

  const reportSyncError = (error) =>
    console.error('[CustomerStats] Member sync failed; keeping the previous count:', error);
  function handleResume() {
    resync().catch(reportSyncError);
  }
  function handleAvailable(guild) {
    if (guild.id === guildId) handleResume();
  }

  async function initialize(botClient) {
    client = botClient;
    client.on('guildMemberAdd', handleMember);
    client.on('guildMemberUpdate', (_oldMember, newMember) => handleMember(newMember));
    client.on('guildMemberRemove', handleRemove);
    client.on('shardResume', handleResume);
    client.on('guildAvailable', handleAvailable);
    reconcileTimer = setInterval(handleResume, RECONCILE_INTERVAL_MS);
    reconcileTimer.unref?.();
    if (!configured())
      console.log(
        '[CustomerStats] Use /customerstats setup to choose the customer role and counter channel.',
      );
    else await resync();
  }

  async function setup(interaction) {
    const guild = interaction.guild;
    const role = interaction.options.getRole('role', true);
    let channel = interaction.options.getChannel('channel');
    const category = interaction.options.getChannel('category');
    if (role.id === guild.id) throw new Error('Choose the customer role, not @everyone.');
    if (channel && category)
      throw new Error('Choose an existing channel OR a category for a new channel.');
    if (channel && (channel.guildId !== guildId || channel.type !== ChannelType.GuildVoice))
      throw new Error('Choose a voice channel on the S-Service server.');
    if (category && (category.guildId !== guildId || category.type !== ChannelType.GuildCategory))
      throw new Error('Choose a category on the S-Service server.');
    const me = guild.members.me ?? (await guild.members.fetchMe());
    if (channel) await requirePermissions(channel, ['ViewChannel', 'ManageChannels']);
    else if (category) await requirePermissions(category, ['ViewChannel', 'ManageChannels']);
    else if (!me.permissions.has(PermissionFlagsBits.ManageChannels))
      throw new Error('The bot needs ManageChannels to create the customer counter.');
    await guild.members.fetch();
    const nextCustomers = new Set(
      guild.members.cache.filter((member) => member.roles.cache.has(role.id)).keys(),
    );
    let created = false;

    if (!channel && !category && configured()) {
      channel = await guild.channels.fetch(store.get().channelId).catch((error) => {
        if (error.code === 10003) return null;
        throw error;
      });
      if (channel?.type !== ChannelType.GuildVoice) channel = null;
      if (channel) await requirePermissions(channel, ['ViewChannel', 'ManageChannels']);
    }
    if (!channel) {
      channel = await guild.channels.create({
        name: channelName(nextCustomers.size),
        type: ChannelType.GuildVoice,
        parent: category?.id,
        permissionOverwrites: [
          {
            id: guild.id,
            allow: [PermissionFlagsBits.ViewChannel],
            deny: [PermissionFlagsBits.Connect],
          },
          {
            id: me.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels],
          },
        ],
        reason: 'S-Service customer statistics',
      });
      created = true;
    }
    try {
      store.set({ guildId, roleId: role.id, channelId: channel.id });
    } catch (error) {
      if (created)
        await channel.delete('Customer stats setup could not be saved').catch(console.error);
      throw error;
    }
    revision += 1;
    customers = nextCustomers;
    snapshotReady = true;
    clearTimeout(renameTimer);
    scheduleUpdate();
    await interaction.editReply({
      content: `✅ Customer counter configured: <#${channel.id}>\n**Role:** <@&${role.id}>\n**Customers:** ${customers.size}\nRole changes and departures update automatically. Channel renames are grouped (up to 6 minutes).`,
      allowedMentions: { parse: [] },
    });
  }

  async function execute(interaction) {
    if (!(await requireAdmin(interaction, guildId))) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      if (interaction.options.getSubcommand() === 'status') {
        const settings = store.get();
        await interaction.editReply({
          content: configured()
            ? `**Customer role:** <@&${settings.roleId}>\n**Counter channel:** <#${settings.channelId}>\n**Customers:** ${snapshotReady ? customers.size : 'Waiting for the first successful member sync'}\nChannel updates may take up to 6 minutes.`
            : 'Not configured. Use `/customerstats setup`.',
          allowedMentions: { parse: [] },
        });
        return;
      }
      if (setupInFlight || renameInFlight || syncPromise)
        throw new Error('Customer statistics are being updated. Try again in a moment.');
      setupInFlight = true;
      try {
        await setup(interaction);
      } finally {
        setupInFlight = false;
      }
    } catch (error) {
      console.error('[CustomerStats] Command failed:', error);
      await interaction.editReply({
        content: `❌ ${commandError(error)}`,
        allowedMentions: { parse: [] },
      });
    }
  }

  return { data, initialize, execute };
};
