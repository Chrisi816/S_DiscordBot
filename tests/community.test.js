const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const {
  Collection,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
  ComponentType,
  ButtonStyle,
} = require('discord.js');
const createCustomerStats = require('../src/modules/customer-stats');
const createWelcome = require('../src/modules/welcome');

const IDS = {
  guild: '100000000000000001',
  role: '111111111111111111',
  customer: '222222222222222222',
  guest: '333333333333333333',
  bot: '444444444444444444',
  counter: '555555555555555555',
  welcome: '666666666666666666',
  news: '777777777777777777',
  tickets: '888888888888888888',
};
const avatar = 'https://cdn.discordapp.com/embed/avatars/0.png';
const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise(setImmediate);
};

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 's-service-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const client = new EventEmitter();
  const channels = new Collection();
  const permissions = { has: () => true };
  const guild = {
    id: IDS.guild,
    iconURL: () => avatar,
    members: { me: { id: IDS.bot, permissions }, cache: new Collection(), fetches: 0 },
    roles: {},
  };
  const role = {
    id: IDS.role,
    get members() {
      return guild.members.cache.filter((member) => member.roles.cache.has(IDS.role));
    },
  };
  guild.roles.fetch = async (id) => (id === IDS.role ? role : null);
  guild.members.fetch = async (id) => {
    guild.members.fetches++;
    return id ? guild.members.cache.get(id) : guild.members.cache;
  };
  const createMember = (id, isCustomer = false, bot = false) => ({
    id,
    guild,
    joinedTimestamp: Date.UTC(2026, 10, 10, 21, 13),
    user: { id, username: `user_${id}`, bot, createdTimestamp: Date.UTC(2019, 6, 1) },
    roles: { cache: new Collection(isCustomer ? [[IDS.role, role]] : []) },
    displayAvatarURL: () => avatar,
  });
  for (const member of [
    createMember(IDS.customer, true),
    createMember(IDS.guest),
    createMember(IDS.bot, true, true),
  ])
    guild.members.cache.set(member.id, member);
  const makeChannel = (id, type, name = 'channel') => ({
    id,
    type,
    name,
    guild,
    guildId: IDS.guild,
    sent: [],
    renames: [],
    permissionsFor: () => permissions,
    async setName(value) {
      this.name = value;
      this.renames.push(value);
      return this;
    },
    async send(payload) {
      this.sent.push(payload);
      return { id: '999999999999999999' };
    },
    async delete() {
      channels.delete(id);
    },
  });
  channels.set(IDS.welcome, makeChannel(IDS.welcome, ChannelType.GuildText));
  channels.set(IDS.news, makeChannel(IDS.news, ChannelType.GuildAnnouncement));
  channels.set(IDS.tickets, makeChannel(IDS.tickets, ChannelType.GuildText));
  guild.channels = {
    created: [],
    async fetch(id) {
      const channel = channels.get(id);
      if (!channel) throw Object.assign(new Error('Unknown channel'), { code: 10003 });
      return channel;
    },
    async create(options) {
      this.created.push(options);
      const channel = makeChannel(IDS.counter, options.type, options.name);
      channels.set(channel.id, channel);
      return channel;
    },
  };
  client.channels = guild.channels;
  client.guilds = { fetch: async () => guild };
  const interaction = (commandName, subcommand, options = {}, admin = true) => ({
    commandName,
    guild,
    guildId: IDS.guild,
    user: { id: IDS.customer, username: 'test_admin', bot: false },
    memberPermissions: { has: () => admin },
    inGuild: () => true,
    replies: [],
    deferred: null,
    options: {
      getSubcommand: () => subcommand,
      getRole: (name) => options[name],
      getChannel: (name) => options[name],
    },
    async reply(payload) {
      this.replies.push(payload);
    },
    async deferReply(payload) {
      this.deferred = payload;
    },
    async editReply(payload) {
      this.replies.push(payload);
    },
  });
  return { directory, client, guild, role, channels, createMember, makeChannel, interaction };
}

test('customer counter includes offline role members, tracks changes, groups renames and persists', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1_800_000_000_000 });
  const f = fixture(t);
  const statePath = path.join(f.directory, 'customer-stats.json');
  const feature = createCustomerStats({ guildId: IDS.guild, statePath });
  await feature.initialize(f.client);
  const setup = f.interaction('customerstats', 'setup', { role: f.role });
  await feature.execute(setup);
  assert.match(setup.replies.at(-1).content, /Customers:\*\* 2/);
  assert.equal(f.guild.members.fetches, 1);
  const channel = f.channels.get(IDS.counter);
  assert.equal(channel.name, '💥︲Customers: 2');
  assert.deepEqual(f.guild.channels.created[0].permissionOverwrites[0].deny, [
    PermissionFlagsBits.Connect,
  ]);
  assert.equal(JSON.parse(fs.readFileSync(statePath)).roleId, IDS.role);
  t.mock.timers.tick(2000);
  await flush();
  assert.equal(channel.renames.length, 0, 'unchanged channel should not be renamed');

  const guest = f.guild.members.cache.get(IDS.guest);
  guest.roles.cache.set(IDS.role, f.role);
  f.client.emit('guildMemberUpdate', null, guest);
  t.mock.timers.tick(2000);
  await flush();
  assert.equal(channel.name, '💥︲Customers: 3');
  assert.equal(channel.renames.length, 1);
  guest.roles.cache.delete(IDS.role);
  f.client.emit('guildMemberUpdate', null, guest);
  f.guild.members.cache.delete(IDS.customer);
  f.client.emit('guildMemberRemove', f.createMember(IDS.customer, true));
  t.mock.timers.tick(2000);
  await flush();
  assert.equal(channel.renames.length, 1, 'cooldown should group updates');
  t.mock.timers.tick(6 * 60 * 1000);
  await flush();
  assert.equal(channel.name, '💥︲Customers: 1');
  assert.equal(channel.renames.length, 2);

  const reconnectClient = new EventEmitter();
  reconnectClient.channels = f.guild.channels;
  reconnectClient.guilds = f.client.guilds;
  const restarted = createCustomerStats({ guildId: IDS.guild, statePath });
  await restarted.initialize(reconnectClient);
  const status = f.interaction('customerstats', 'status');

  await restarted.execute(status);
  assert.match(status.replies[0].content, /Customers:\*\* 1/);
  assert.equal(channel.renames.length, 2, 'restart with correct channel name should not rename it');
  assert.ok(f.guild.members.fetches >= 2);
});

test('counter setup reuses its channel and denies non-administrators', async (t) => {
  const f = fixture(t);
  const feature = createCustomerStats({
    guildId: IDS.guild,
    statePath: path.join(f.directory, 'stats.json'),
  });
  await feature.initialize(f.client);
  await feature.execute(f.interaction('customerstats', 'setup', { role: f.role }));
  await feature.execute(f.interaction('customerstats', 'setup', { role: f.role }));
  assert.equal(f.guild.channels.created.length, 1);
  const denied = f.interaction('customerstats', 'setup', { role: f.role }, false);
  await feature.execute(denied);
  assert.equal(denied.deferred, null);
  assert.equal(denied.replies[0].flags, MessageFlags.Ephemeral);
  assert.match(denied.replies[0].content, /administrators/);
});

test('failed initial member sync never writes a partial or zero count', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1_800_000_000_000 });
  const f = fixture(t);
  const channel = f.makeChannel(IDS.counter, ChannelType.GuildVoice, '💥︲Customers: 478');
  f.channels.set(channel.id, channel);
  const statePath = path.join(f.directory, 'stats.json');
  fs.writeFileSync(
    statePath,
    JSON.stringify({ guildId: IDS.guild, roleId: IDS.role, channelId: channel.id }),
  );
  const fetchMembers = f.guild.members.fetch;
  f.guild.members.fetch = async () => {
    throw new Error('Member sync unavailable');
  };
  const feature = createCustomerStats({ guildId: IDS.guild, statePath });
  await assert.rejects(feature.initialize(f.client), /Member sync unavailable/);
  f.client.emit('guildMemberRemove', f.createMember(IDS.customer, true));
  t.mock.timers.tick(6 * 60 * 1000);
  await flush();
  assert.equal(channel.renames.length, 0);
  assert.equal(channel.name, '💥︲Customers: 478');
  f.guild.members.fetch = fetchMembers;
  f.client.emit('shardResume');
  await flush();
  assert.equal(channel.name, '💥︲Customers: 2');
});

test('welcome card has banner first, S-Service red, avatar, member dates and working channel buttons', async (t) => {
  const f = fixture(t);
  const statePath = path.join(f.directory, 'welcome.json');
  const feature = createWelcome({ guildId: IDS.guild, statePath });
  await feature.initialize(f.client);
  const setup = f.interaction('welcome', 'setup', {
    channel: f.channels.get(IDS.welcome),
    announcements: f.channels.get(IDS.news),
    ticket: f.channels.get(IDS.tickets),
  });
  await feature.execute(setup);
  assert.match(setup.replies[0].content, /enabled/);
  const member = f.createMember('123456789012345678');
  f.client.emit('guildMemberAdd', member);
  await flush();
  const channel = f.channels.get(IDS.welcome);
  assert.equal(channel.sent.length, 1);
  const payload = channel.sent[0];
  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.equal(Object.hasOwn(payload, 'content'), false);
  assert.equal(Object.hasOwn(payload, 'embeds'), false);
  const panel = payload.components[0].toJSON();
  assert.equal(panel.type, ComponentType.Container);
  assert.equal(panel.accent_color, 0xf91c2b);
  assert.equal(panel.components[0].type, ComponentType.MediaGallery);
  assert.equal(panel.components[0].items[0].media.url, 'attachment://banner_welcome.png');
  const introduction = panel.components.find(
    (component) => component.type === ComponentType.Section,
  );
  assert.equal(introduction.accessory.media.url, avatar);
  const text = panel.components
    .flatMap((component) =>
      component.type === ComponentType.Section ? component.components : [component],
    )
    .filter((component) => component.type === ComponentType.TextDisplay)
    .map((component) => component.content)
    .join('\n');
  assert.match(text, /Welcome to S-Service/);
  assert.match(text, new RegExp(`<@${member.id}>`));
  assert.match(text, new RegExp(`<#${IDS.news}>`));
  assert.match(text, new RegExp(`<#${IDS.tickets}>`));
  assert.ok(text.includes(`<t:${Math.floor(member.joinedTimestamp / 1000)}:f>`));
  assert.ok(text.includes(`<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`));
  assert.ok(text.includes(`<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`));
  assert.ok(text.length <= 4000);
  const buttons = panel.components.find(
    (component) => component.type === ComponentType.ActionRow,
  ).components;
  assert.deepEqual(
    buttons.map((button) => button.style),
    [ButtonStyle.Link, ButtonStyle.Link],
  );
  assert.deepEqual(
    buttons.map((button) => button.url),
    [
      `https://discord.com/channels/${IDS.guild}/${IDS.news}`,
      `https://discord.com/channels/${IDS.guild}/${IDS.tickets}`,
    ],
  );
  assert.deepEqual(payload.allowedMentions, { parse: [], users: [member.id] });
  assert.ok(fs.existsSync(payload.files[0].attachment));
  assert.ok(
    fs
      .readFileSync(payload.files[0].attachment)
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  );
  const withoutDates = f.createMember('123456789012345679');
  withoutDates.joinedTimestamp = null;
  withoutDates.user.createdTimestamp = undefined;
  const fallback = JSON.stringify(
    createWelcome
      .buildWelcomePayload(withoutDates, {
        announcementsChannelId: IDS.news,
        ticketChannelId: IDS.tickets,
      })
      .components[0].toJSON(),
  );
  assert.equal(fallback.includes('<t:NaN'), false);
  assert.equal(fallback.includes('<t:0:'), false);
  f.client.emit('guildMemberAdd', member);
  await flush();
  assert.equal(channel.sent.length, 1, 'duplicate join should not send a second welcome');
  f.client.emit('guildMemberAdd', f.createMember(IDS.bot, false, true));
  await flush();
  assert.equal(channel.sent.length, 1, 'bots should not be welcomed');
  f.client.emit('guildMemberRemove', member);
  f.client.emit('guildMemberAdd', member);
  await flush();
  assert.equal(channel.sent.length, 2, 'a genuine rejoin should be welcomed');

  const preview = f.interaction('welcome', 'test');
  await feature.execute(preview);
  assert.deepEqual(channel.sent.at(-1).allowedMentions.users, []);
  assert.match(preview.replies[0].content, /preview sent/);
  assert.equal(JSON.parse(fs.readFileSync(statePath)).channelId, IDS.welcome);

  const restartedClient = new EventEmitter();
  restartedClient.channels = f.guild.channels;
  const restarted = createWelcome({ guildId: IDS.guild, statePath });
  await restarted.initialize(restartedClient);
  restartedClient.emit('guildMemberAdd', member);
  await flush();
  assert.equal(channel.sent.length, 4, 'restart should load welcome settings');
  await restarted.execute(f.interaction('welcome', 'disable'));
  restartedClient.emit('guildMemberRemove', member);
  restartedClient.emit('guildMemberAdd', member);
  await flush();
  assert.equal(channel.sent.length, 4, 'disable should stop sending welcome messages');
});

test('welcome checks administrator and channel permissions before saving configuration', async (t) => {
  const f = fixture(t);
  const statePath = path.join(f.directory, 'welcome.json');
  const feature = createWelcome({ guildId: IDS.guild, statePath });
  await feature.initialize(f.client);
  const options = {
    channel: f.channels.get(IDS.welcome),
    announcements: f.channels.get(IDS.news),
    ticket: f.channels.get(IDS.tickets),
  };
  const denied = f.interaction('welcome', 'setup', options, false);
  await feature.execute(denied);
  assert.match(denied.replies[0].content, /administrators/);
  f.channels.get(IDS.welcome).permissionsFor = () => ({
    has: (bit) => bit !== PermissionFlagsBits.AttachFiles,
  });
  const missingPermission = f.interaction('welcome', 'setup', options);
  const originalError = console.error;
  console.error = () => {};
  try {
    await feature.execute(missingPermission);
  } finally {
    console.error = originalError;
  }
  assert.match(missingPermission.replies[0].content, /AttachFiles/);
  assert.equal(fs.existsSync(statePath), false);
});

test('all new slash command schemas serialize with unique names', (t) => {
  const f = fixture(t);
  const modules = [
    createCustomerStats({ guildId: IDS.guild, statePath: path.join(f.directory, 'stats.json') }),
    createWelcome({ guildId: IDS.guild, statePath: path.join(f.directory, 'welcome.json') }),
  ];
  const commands = modules.flatMap((feature) => feature.data.map((command) => command.toJSON()));
  assert.deepEqual(
    commands.map((command) => command.name),
    ['customerstats', 'welcome'],
  );
  for (const command of commands)
    assert.equal(command.default_member_permissions, PermissionFlagsBits.Administrator.toString());
});
