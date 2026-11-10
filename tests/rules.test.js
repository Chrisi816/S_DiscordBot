const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  Collection,
  PermissionsBitField,
  PermissionFlagsBits,
  ChannelType,
  ComponentType,
  MessageFlags,
} = require('discord.js');
const createRules = require('../src/modules/rules');
const { createCaptcha, renderCaptcha } = require('../src/modules/verification-captcha');

const ids = {
  guild: '100000000000000001',
  role: '111111111111111111',
  channel: '222222222222222222',
  bot: '333333333333333333',
  user: '444444444444444444',
  other: '555555555555555555',
  oldRole: '666666666666666666',
  secondChannel: '777777777777777777',
};
const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function collectComponents(root) {
  return [
    root,
    ...(root.components ?? []).flatMap(collectComponents),
    ...(root.accessory ? collectComponents(root.accessory) : []),
  ];
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 's-service-rules-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, 'rules.json');
  let timestamp = Date.UTC(2026, 10, 10, 22);
  let messageSequence = 0;
  let captchaSequence = 0;
  let challenge;
  const role = {
    id: ids.role,
    managed: false,
    editable: true,
    permissions: new PermissionsBitField(),
  };
  const me = { id: ids.bot, permissions: new PermissionsBitField(PermissionFlagsBits.ManageRoles) };
  const users = new Map();
  const grants = [];
  const guild = {
    id: ids.guild,
    iconURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
    roles: { fetch: async (roleId) => (roleId === role.id ? role : null) },
    members: {
      me,
      fetchMe: async () => me,
      fetch: async (options) => users.get(typeof options === 'string' ? options : options.user),
    },
  };
  for (const id of [ids.user, ids.other]) {
    const cache = new Collection([[ids.oldRole, { id: ids.oldRole }]]);
    users.set(id, {
      id,
      user: { id, bot: false },
      guild,
      roles: {
        cache,
        async add(roleId) {
          grants.push({ userId: id, roleId });
          cache.set(roleId, { id: roleId });
        },
      },
    });
  }
  const channels = new Map();
  function makeChannel(id) {
    const messages = new Map();
    return {
      id,
      guild,
      guildId: ids.guild,
      type: ChannelType.GuildText,
      posts: [],
      messages,
      permissionsFor: () => ({ has: () => true }),
      async send(payload) {
        const message = {
          id: String(900000000000000000n + BigInt(++messageSequence)),
          author: { id: ids.bot },
          payload,
          edits: 0,
          async edit(next) {
            this.payload = next;
            this.edits++;
            return this;
          },
          async delete() {
            messages.delete(this.id);
            this.deleted = true;
          },
        };
        messages.set(message.id, message);
        this.posts.push(message);
        return message;
      },
    };
  }
  for (const id of [ids.channel, ids.secondChannel]) {
    const channel = makeChannel(id);
    channel.messages.fetch = async (messageId) => {
      const message = channel.messages.get(messageId);
      if (!message) throw Object.assign(new Error('Unknown Message'), { code: 10008 });
      return message;
    };
    channels.set(id, channel);
  }
  const channel = channels.get(ids.channel);
  const client = { user: { id: ids.bot }, channels: { fetch: async (id) => channels.get(id) } };
  const captchaFactory = async () => {
    captchaSequence++;
    challenge = {
      id: `challenge-${captchaSequence}`,
      image: pngHeader,
      correctValue: `opaque-correct-${captchaSequence}`,
      options: [
        { label: '764829', value: `opaque-correct-${captchaSequence}` },
        { label: '478926', value: `opaque-wrong-${captchaSequence}` },
      ],
    };
    return challenge;
  };
  function interaction({
    kind = 'command',
    sub = 'create',
    customId = '',
    values,
    userId = ids.user,
    admin = true,
    selectedChannel = channel,
    selectedRole = role,
    sourceAuthor = ids.bot,
  } = {}) {
    return {
      guild,
      guildId: ids.guild,
      channelId: selectedChannel.id,
      channel: selectedChannel,
      user: { id: userId, bot: false },
      memberPermissions: { has: () => admin },
      message: { author: { id: sourceAuthor } },
      customId,
      values,
      inGuild: () => true,
      isButton: () => kind === 'button',
      isStringSelectMenu: () => kind === 'select',
      options: {
        getSubcommand: () => sub,
        getChannel: () => selectedChannel,
        getRole: () => selectedRole,
      },
      replies: [],
      deferred: null,
      updates: 0,
      async reply(payload) {
        this.replies.push(payload);
      },
      async deferReply(payload) {
        this.deferred = payload;
      },
      async deferUpdate() {
        this.updates++;
      },
      async editReply(payload) {
        this.replies.push(payload);
      },
    };
  }
  const options = { guildId: ids.guild, statePath, captchaFactory, now: () => timestamp };
  const feature = createRules(options);
  const start = (language = 'en', userId = ids.user) =>
    interaction({ kind: 'button', customId: `sservice:rules:verify:${language}`, userId });
  const answer = (value, challengeId = challenge.id, userId = ids.user) =>
    interaction({
      kind: 'select',
      customId: `sservice:captcha:${challengeId}`,
      values: [value],
      userId,
    });
  return {
    feature,
    options,
    client,
    guild,
    role,
    me,
    users,
    channel,
    channels,
    grants,
    statePath,
    interaction,
    start,
    answer,
    get challenge() {
      return challenge;
    },
    get captchaCount() {
      return captchaSequence;
    },
    advance: (ms) => {
      timestamp += ms;
    },
  };
}

async function configure(f) {
  await f.feature.initialize(f.client);
  const setup = f.interaction();
  await f.feature.execute(setup);
  assert.match(setup.replies.at(-1).content, /combined/);
}

function statusText(interaction) {
  return JSON.stringify(interaction.replies.at(-1), (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
}

test('one public panel merges rules, terms and verification in the Welcome design, with private German translation', async (t) => {
  const f = fixture(t);
  await configure(f);
  for (const lang of ['en', 'de']) {
    const payload = createRules.buildRulesPayload(f.guild, lang);
    assert.equal(payload.flags, MessageFlags.IsComponentsV2);
    assert.equal(payload.components.length, 1);
    assert.equal(Object.hasOwn(payload, 'embeds'), false);
    const panel = payload.components[0].toJSON();
    assert.equal(panel.accent_color, 0xf91c2b);
    assert.equal(panel.components[0].type, ComponentType.MediaGallery);
    assert.equal(panel.components[0].items[0].media.url, 'attachment://banner_rules.png');
    const all = collectComponents(panel);
    assert.ok(all.length <= 40);
    const text = all
      .filter((item) => item.type === ComponentType.TextDisplay)
      .map((item) => item.content)
      .join('\n');
    assert.ok(text.length <= 4000);
    assert.equal(
      (text.match(lang === 'en' ? /Protect product files/g : /Produktdateien schützen/g) ?? [])
        .length,
      1,
    );
    const buttons = all.filter((item) => item.type === ComponentType.Button);
    assert.equal(
      buttons.filter((button) => button.custom_id?.startsWith('sservice:rules:verify:')).length,
      1,
    );
    assert.equal(
      buttons.filter((button) => button.url === 'https://discord.com/guidelines').length,
      1,
    );
    assert.equal(buttons.filter((button) => button.url === 'https://discord.com/terms').length, 1);
    assert.ok(fs.existsSync(payload.files[0].attachment));
  }
  const translation = f.interaction({ kind: 'button', customId: 'sservice:rules:language:de' });
  await f.feature.handleButton(translation);
  assert.equal(translation.deferred.flags, MessageFlags.Ephemeral);
  assert.match(statusText(translation), /Regeln & Verifizierung/);
  assert.equal(f.channel.posts.length, 1);
});

test('correct user-bound captcha grants only the configured new role and cannot be replayed', async (t) => {
  const f = fixture(t);
  await configure(f);
  assert.equal(f.users.get(ids.user).roles.cache.has(ids.role), false);
  const start = f.start('de');
  await f.feature.handleButton(start);
  assert.equal(start.deferred.flags, MessageFlags.Ephemeral);
  assert.equal(f.grants.length, 0);
  const savedChallenge = f.challenge;
  const repeatedStart = f.start();
  await f.feature.handleButton(repeatedStart);
  assert.equal(f.captchaCount, 1, 'repeated start should reuse the active challenge');
  const captchaPanel = start.replies.at(-1).components[0].toJSON();
  assert.equal(
    captchaPanel.components.at(-1).components[0].custom_id,
    `sservice:captcha:${savedChallenge.id}`,
  );
  const answer = f.answer(savedChallenge.correctValue);
  await f.feature.handleCaptcha(answer);
  assert.deepEqual(f.grants, [{ userId: ids.user, roleId: ids.role }]);
  assert.equal(f.users.get(ids.user).roles.cache.has(ids.oldRole), true);
  assert.match(statusText(answer), /Erfolgreich verifiziert/);
  assert.deepEqual(answer.replies.at(-1).attachments, []);
  await f.feature.handleCaptcha(f.answer(savedChallenge.correctValue));
  assert.equal(f.grants.length, 1);
  const already = f.start();
  await f.feature.handleButton(already);
  assert.match(statusText(already), /already/);
  assert.equal(f.captchaCount, 1);
});

test('a wrong or fabricated option never grants a role and imposes cooldown', async (t) => {
  const f = fixture(t);
  await configure(f);
  await f.feature.handleButton(f.start());
  const previous = f.challenge;
  const wrong = f.answer('invented-value');
  await f.feature.handleCaptcha(wrong);
  assert.equal(f.grants.length, 0);
  assert.match(statusText(wrong), /did not match/);
  await f.feature.handleCaptcha(f.answer(previous.correctValue, previous.id));
  assert.equal(f.grants.length, 0, 'consumed challenge cannot be retried with the correct choice');
  const cooldown = f.start();
  await f.feature.handleButton(cooldown);
  assert.match(statusText(cooldown), /wait 60 seconds/);
  assert.equal(f.captchaCount, 1);
  f.advance(60_001);
  await f.feature.handleButton(f.start());
  assert.equal(f.captchaCount, 2);
  await f.feature.handleCaptcha(f.answer(f.challenge.correctValue));
  assert.equal(f.grants.length, 1);
});

test('three wrong captchas cause a ten-minute cooldown', async (t) => {
  const f = fixture(t);
  await configure(f);
  for (let attempt = 0; attempt < 3; attempt++) {
    await f.feature.handleButton(f.start());
    await f.feature.handleCaptcha(f.answer('wrong'));
    if (attempt < 2) f.advance(60_001);
  }
  const blocked = f.start();
  await f.feature.handleButton(blocked);
  assert.match(statusText(blocked), /wait 600 seconds/);
  assert.equal(f.captchaCount, 3);
  assert.equal(f.grants.length, 0);
});

test('expired captchas and another user cannot claim the role', async (t) => {
  const f = fixture(t);
  await configure(f);
  await f.feature.handleButton(f.start());
  const saved = f.challenge;
  await f.feature.handleCaptcha(f.answer(saved.correctValue, saved.id, ids.other));
  assert.equal(f.grants.length, 0);
  f.advance(120_001);
  const expired = f.answer(saved.correctValue, saved.id);
  await f.feature.handleCaptcha(expired);
  assert.equal(f.grants.length, 0);
  assert.match(statusText(expired), /expired/);
  await f.feature.handleButton(f.start());
  assert.equal(f.captchaCount, 2);
});

test('parallel correct submissions can assign the role only once', async (t) => {
  const f = fixture(t);
  await configure(f);
  await f.feature.handleButton(f.start());
  const correct = f.challenge.correctValue;
  await Promise.all([
    f.feature.handleCaptcha(f.answer(correct)),
    f.feature.handleCaptcha(f.answer(correct)),
  ]);
  assert.equal(f.grants.length, 1);
});

test('admin setup validates hierarchy and privileged roles; ordinary members cannot reconfigure', async (t) => {
  const f = fixture(t);
  await f.feature.initialize(f.client);
  const denied = f.interaction({ admin: false });
  await f.feature.execute(denied);
  assert.match(statusText(denied), /administrators/);
  assert.equal(f.channel.posts.length, 0);
  const originalError = console.error;
  console.error = () => {};
  try {
    f.role.editable = false;
    const hierarchy = f.interaction();
    await f.feature.execute(hierarchy);
    assert.match(statusText(hierarchy), /below the bot role/);
    f.role.editable = true;
    f.role.permissions = new PermissionsBitField(PermissionFlagsBits.Administrator);
    const privileged = f.interaction();
    await f.feature.execute(privileged);
    assert.match(statusText(privileged), /administrator or moderation/);
    f.role.permissions = new PermissionsBitField();
    f.me.permissions = new PermissionsBitField();
    const missingPermission = f.interaction();
    await f.feature.execute(missingPermission);
    assert.match(statusText(missingPermission), /ManageRoles/);
  } finally {
    console.error = originalError;
  }
  assert.equal(f.channel.posts.length, 0);
  assert.equal(fs.existsSync(f.statePath), false);
});

test('a role that becomes privileged or uneditable after starting cannot be awarded', async (t) => {
  const f = fixture(t);
  await configure(f);
  await f.feature.handleButton(f.start());
  f.role.permissions = new PermissionsBitField(PermissionFlagsBits.ManageRoles);
  const originalError = console.error;
  console.error = () => {};
  try {
    await f.feature.handleCaptcha(f.answer(f.challenge.correctValue));
  } finally {
    console.error = originalError;
  }
  assert.equal(f.grants.length, 0);
});

test('setup updates a single panel, survives restart, and disabling invalidates active captchas', async (t) => {
  const f = fixture(t);
  await configure(f);
  await f.feature.execute(f.interaction());
  assert.equal(f.channel.posts.length, 1);
  assert.equal(f.channel.posts[0].edits, 1);
  const restarted = createRules(f.options);
  await restarted.initialize(f.client);
  const status = f.interaction({ sub: 'status' });
  await restarted.execute(status);
  assert.match(statusText(status), new RegExp(ids.role));
  await restarted.handleButton(f.start());
  await restarted.execute(f.interaction({ sub: 'disable' }));
  await restarted.handleCaptcha(f.answer(f.challenge.correctValue));
  assert.equal(f.grants.length, 0);
  await f.feature.execute(f.interaction({ selectedChannel: f.channels.get(ids.secondChannel) }));
  assert.equal(f.channel.posts[0].deleted, true);
  assert.equal(f.channels.get(ids.secondChannel).posts.length, 1);
});

test('captcha is rejected from a different channel or a different bot message', async (t) => {
  const f = fixture(t);
  await configure(f);
  for (const overrides of [
    { selectedChannel: f.channels.get(ids.secondChannel) },
    { sourceAuthor: ids.other },
  ]) {
    const start = f.interaction({
      kind: 'button',
      customId: 'sservice:rules:verify:en',
      ...overrides,
    });
    await f.feature.handleButton(start);
    assert.match(statusText(start), /not active/);
  }
  assert.equal(f.captchaCount, 0);
  assert.equal(f.grants.length, 0);
});

test('real captcha images encode as PNG; answer tokens are random and labels are unique', async () => {
  const challenge = await createCaptcha();
  assert.ok(challenge.image.subarray(0, 8).equals(pngHeader));
  assert.equal(challenge.image.readUInt32BE(16), 640);
  assert.equal(challenge.image.readUInt32BE(20), 180);
  assert.equal(challenge.options.length, 6);
  assert.equal(new Set(challenge.options.map((item) => item.label)).size, 6);
  assert.equal(challenge.options.filter((item) => item.value === challenge.correctValue).length, 1);
  for (const option of challenge.options) {
    assert.match(option.label, /^[2-9]{6}$/);
    assert.match(option.value, /^[a-f0-9]{32}$/);
    assert.notEqual(option.value, option.label);
  }
  await assert.rejects(renderCaptcha('invalid'), /six digits/);
});

test('rules slash schema serializes with a mandatory role and optional channel', (t) => {
  const f = fixture(t);
  const command = f.feature.data[0].toJSON();
  assert.equal(command.name, 'rules');
  assert.equal(command.default_member_permissions, PermissionFlagsBits.Administrator.toString());
  const create = command.options.find((option) => option.name === 'create');
  assert.equal(create.options.find((option) => option.name === 'role').required, true);
  assert.equal(create.options.find((option) => option.name === 'channel').required, false);
});
