const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const {
  ChannelType,
  MessageType,
  MessageFlags,
  PermissionFlagsBits,
  ComponentType,
} = require('discord.js');
const createBooster = require('../src/modules/booster');

const ids = {
  guild: '100000000000000001',
  channel: '111111111111111111',
  user: '222222222222222222',
};
const avatar = 'https://cdn.discordapp.com/embed/avatars/0.png';
const flush = async () => {
  for (let index = 0; index < 4; index++) await new Promise(setImmediate);
};

function fixture(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_800_000_000_000 });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 's-service-boost-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, 'booster.json');
  const user = { id: ids.user, bot: false, displayAvatarURL: () => avatar };
  const guild = {
    id: ids.guild,
    iconURL: () => avatar,
    members: { me: {}, fetch: async () => member(Date.now()) },
  };
  const member = (premiumSinceTimestamp, extra = {}) => ({
    id: ids.user,
    guild,
    user,
    premiumSinceTimestamp,
    partial: false,
    displayAvatarURL: () => avatar,
    ...extra,
  });
  const channel = {
    id: ids.channel,
    guild,
    guildId: ids.guild,
    type: ChannelType.GuildText,
    sent: [],
    permissionsFor: () => ({ has: () => true }),
    async send(payload) {
      this.sent.push(payload);
    },
  };
  const client = new EventEmitter();
  client.channels = { fetch: async () => channel };
  const feature = createBooster({ guildId: ids.guild, statePath, now: () => Date.now() });
  const interaction = (subcommand, admin = true) => ({
    guild,
    guildId: ids.guild,
    channel,
    user,
    inGuild: () => true,
    memberPermissions: { has: () => admin },
    options: { getSubcommand: () => subcommand, getChannel: () => channel },
    replies: [],
    deferred: null,
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
  let sequence = 0;
  const message = (type = MessageType.GuildBoost, extras = {}) => ({
    id: String(900000000000000000n + BigInt(++sequence)),
    type,
    guild,
    guildId: ids.guild,
    author: user,
    member: member(Date.now()),
    createdTimestamp: Date.now(),
    ...extras,
  });
  return { statePath, user, guild, member, channel, client, feature, interaction, message };
}

async function setup(f) {
  await f.feature.initialize(f.client);
  await f.feature.execute(f.interaction('setup'));
}

test('booster card matches Welcome layout with banner first, sections, avatar and timestamp', (t) => {
  const f = fixture(t);
  const payload = createBooster.buildBoostPayload(f.guild, f.user);
  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.equal(Object.hasOwn(payload, 'embeds'), false);
  assert.equal(Object.hasOwn(payload, 'content'), false);
  assert.equal(payload.components.length, 1);
  const panel = payload.components[0].toJSON();
  assert.equal(panel.type, ComponentType.Container);
  assert.equal(panel.accent_color, 0xf91c2b);
  assert.equal(panel.components[0].type, ComponentType.MediaGallery);
  assert.equal(panel.components[0].items[0].media.url, 'attachment://banner_booster.png');
  const introduction = panel.components.find((item) => item.type === ComponentType.Section);
  assert.equal(introduction.accessory.media.url, avatar);
  const text = panel.components
    .flatMap((item) => (item.type === ComponentType.Section ? item.components : [item]))
    .filter((item) => item.type === ComponentType.TextDisplay)
    .map((item) => item.content)
    .join('\n');
  assert.match(text, /Thanks for the boost/);
  assert.match(text, /Powered by our community/);
  assert.match(text, new RegExp(`<@${ids.user}>`));
  assert.ok(text.includes(`<t:${Math.floor(Date.now() / 1000)}:f>`));
  assert.ok(text.length <= 4000);
  assert.ok(fs.existsSync(payload.files[0].attachment));
  assert.deepEqual(payload.allowedMentions, { parse: [], users: [ids.user] });
  const withMember = createBooster
    .buildBoostPayload(f.guild, f.user, {
      member: f.member(Date.now(), {
        displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/1.png',
      }),
      notify: false,
    })
    .components[0].toJSON();
  assert.equal(
    withMember.components.find((item) => item.type === ComponentType.Section).accessory.media.url,
    'https://cdn.discordapp.com/embed/avatars/1.png',
  );
});

test('booster setup persists, test preview is sent without mentions, and only admins may configure', async (t) => {
  const f = fixture(t);
  await setup(f);
  assert.equal(JSON.parse(fs.readFileSync(f.statePath)).channelId, ids.channel);
  const preview = f.interaction('test');
  await f.feature.execute(preview);
  assert.equal(f.channel.sent.length, 1);
  assert.deepEqual(f.channel.sent[0].allowedMentions.users, []);
  assert.equal(preview.deferred.flags, MessageFlags.Ephemeral);
  const denied = f.interaction('disable', false);
  await f.feature.execute(denied);
  assert.match(denied.replies[0].content, /administrators/);
  const restarted = createBooster({ guildId: ids.guild, statePath: f.statePath });
  await restarted.initialize(new EventEmitterWithChannels(f.client.channels));
  const status = f.interaction('status');
  await restarted.execute(status);
  assert.match(status.replies[0].content, new RegExp(ids.channel));
  assert.equal(
    f.channel.sent.length,
    1,
    'startup must not send notifications for existing boosters',
  );
});

class EventEmitterWithChannels extends EventEmitter {
  constructor(channels) {
    super();
    this.channels = channels;
  }
}

test('native boost events include additional boosts and tier boosts; duplicate message IDs are ignored', async (t) => {
  const f = fixture(t);
  await setup(f);
  for (const type of [
    MessageType.GuildBoost,
    MessageType.GuildBoostTier1,
    MessageType.GuildBoostTier2,
    MessageType.GuildBoostTier3,
  ]) {
    const message = f.message(type);
    assert.equal(await f.feature.handleMessage(message), true);
    await f.feature.handleMessage(message);
  }
  assert.equal(f.channel.sent.length, 4);
  await f.feature.handleMessage(f.message(MessageType.GuildBoost));
  assert.equal(
    f.channel.sent.length,
    5,
    'a new message ID from the same booster is a separate boost',
  );
  assert.equal(await f.feature.handleMessage(f.message(MessageType.Default)), false);
  assert.equal(
    await f.feature.handleMessage(
      f.message(MessageType.GuildBoost, { guildId: '999999999999999999' }),
    ),
    false,
  );
  assert.equal(f.channel.sent.length, 5);
});

test('member transition detects a first boost when no native boost message arrives', async (t) => {
  const f = fixture(t);
  await setup(f);
  const old = f.member(null),
    current = f.member(Date.now());
  f.client.emit('guildMemberUpdate', old, current);
  f.client.emit('guildMemberUpdate', old, current);
  t.mock.timers.tick(7999);
  await flush();
  assert.equal(f.channel.sent.length, 0);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(f.channel.sent.length, 1);
  f.client.emit('guildMemberUpdate', current, current);
  f.client.emit('guildMemberUpdate', f.member(undefined, { partial: true }), current);
  f.client.emit(
    'guildMemberUpdate',
    f.member(null),
    f.member(Date.now(), { user: { ...f.user, bot: true } }),
  );
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(f.channel.sent.length, 1);
});

test('member-first, system-first and late-system orderings each produce one boost notification', async (t) => {
  const f = fixture(t);
  await setup(f);
  const old = f.member(null),
    current = f.member(Date.now());
  f.client.emit('guildMemberUpdate', old, current);
  await f.feature.handleMessage(f.message());
  t.mock.timers.tick(8000);
  await flush();
  assert.equal(f.channel.sent.length, 1);

  f.client.emit('guildMemberUpdate', current, f.member(null));
  t.mock.timers.tick(1000);
  const next = f.member(Date.now());
  await f.feature.handleMessage(f.message());
  f.client.emit('guildMemberUpdate', f.member(null), next);
  t.mock.timers.tick(8000);
  await flush();
  assert.equal(f.channel.sent.length, 2);

  f.client.emit('guildMemberUpdate', next, f.member(null));
  t.mock.timers.tick(1000);
  f.client.emit('guildMemberUpdate', f.member(null), f.member(Date.now()));
  t.mock.timers.tick(8000);
  await flush();
  assert.equal(f.channel.sent.length, 3);
  await f.feature.handleMessage(f.message());
  assert.equal(f.channel.sent.length, 3);
  await f.feature.handleMessage(f.message());
  assert.equal(
    f.channel.sent.length,
    4,
    'the next genuine boost is not swallowed by deduplication',
  );
});

test('disabling or stopping boosting cancels pending fallback notifications', async (t) => {
  const f = fixture(t);
  await setup(f);
  const current = f.member(Date.now());
  f.client.emit('guildMemberUpdate', f.member(null), current);
  f.client.emit('guildMemberUpdate', current, f.member(null));
  t.mock.timers.tick(9000);
  await flush();
  assert.equal(f.channel.sent.length, 0);
  f.client.emit('guildMemberUpdate', f.member(null), f.member(Date.now()));
  await f.feature.execute(f.interaction('disable'));
  t.mock.timers.tick(9000);
  await flush();
  await f.feature.handleMessage(f.message());
  assert.equal(f.channel.sent.length, 0);
});

test('permission failures do not save setup and failed native sends can be retried', async (t) => {
  const f = fixture(t);
  await f.feature.initialize(f.client);
  f.channel.permissionsFor = () => ({
    has: (permission) => permission !== PermissionFlagsBits.EmbedLinks,
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    const denied = f.interaction('setup');
    await f.feature.execute(denied);
    assert.match(denied.replies[0].content, /EmbedLinks/);
    assert.equal(fs.existsSync(f.statePath), false);
    f.channel.permissionsFor = () => ({ has: () => true });
    await f.feature.execute(f.interaction('setup'));
    const send = f.channel.send;
    f.channel.send = async () => {
      throw new Error('Temporary send error');
    };
    const message = f.message();
    await f.feature.handleMessage(message);
    assert.equal(f.channel.sent.length, 0);
    f.channel.send = send;
    await f.feature.handleMessage(message);
    assert.equal(f.channel.sent.length, 1);
  } finally {
    console.error = originalError;
  }
});

test('booster command schema has the setup channel and admin permissions', (t) => {
  const f = fixture(t);
  const command = f.feature.data[0].toJSON();
  assert.equal(command.name, 'booster');
  assert.equal(command.default_member_permissions, PermissionFlagsBits.Administrator.toString());
  assert.equal(command.options.find((sub) => sub.name === 'setup').options[0].required, true);
});
