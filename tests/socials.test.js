const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ChannelType,
  ComponentType,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const createSocials = require('../src/modules/socials');
const links = require('../config/socials.json');

const ids = {
  guild: '100000000000000001',
  channel: '111111111111111111',
  other: '222222222222222222',
  bot: '333333333333333333',
};

function components(root) {
  return [
    root,
    ...(root.components ?? []).flatMap(components),
    ...(root.accessory ? components(root.accessory) : []),
  ];
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 's-service-socials-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, 'socials.json');
  const guild = {
    id: ids.guild,
    iconURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
    members: { me: {} },
  };
  const channels = new Map();
  let messageSequence = 0;
  for (const id of [ids.channel, ids.other]) {
    const messages = new Map();
    const channel = {
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
            this.deleted = true;
            messages.delete(this.id);
          },
        };
        messages.set(message.id, message);
        this.posts.push(message);
        return message;
      },
    };
    messages.fetch = async (messageId) => {
      if (!messages.has(messageId))
        throw Object.assign(new Error('Unknown message'), { code: 10008 });
      return messages.get(messageId);
    };
    channels.set(id, channel);
  }
  const client = { user: { id: ids.bot }, channels: { fetch: async (id) => channels.get(id) } };
  const feature = createSocials({ guildId: ids.guild, statePath });
  const channel = channels.get(ids.channel);
  const interaction = ({
    subcommand = 'create',
    admin = true,
    selectedChannel = channel,
    kind = 'command',
    customId = '',
    authorId = ids.bot,
  } = {}) => ({
    guild,
    guildId: ids.guild,
    channel: selectedChannel,
    channelId: selectedChannel.id,
    inGuild: () => true,
    isButton: () => kind === 'button',
    memberPermissions: { has: () => admin },
    customId,
    message: { author: { id: authorId } },
    options: { getSubcommand: () => subcommand, getChannel: () => selectedChannel },
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
  return { feature, statePath, guild, client, channel, channels, interaction };
}

async function publish(f) {
  await f.feature.initialize(f.client);
  const create = f.interaction();
  await f.feature.execute(create);
  assert.match(create.replies.at(-1).content, /Socials panel posted/);
}

test('Socials cards use Welcome layout, all four actual links and a language button in both languages', (t) => {
  const f = fixture(t);
  for (const language of ['en', 'de']) {
    const payload = createSocials.buildSocialsPayload(f.guild, links, language);
    assert.equal(payload.flags, MessageFlags.IsComponentsV2);
    assert.equal(Object.hasOwn(payload, 'embeds'), false);
    assert.deepEqual(payload.allowedMentions, { parse: [] });
    assert.equal(payload.components.length, 1);
    const panel = payload.components[0].toJSON();
    assert.equal(panel.accent_color, 0xf91c2b);
    assert.equal(panel.components[0].type, ComponentType.MediaGallery);
    assert.equal(panel.components[0].items[0].media.url, 'attachment://banner_socials.png');
    assert.ok(fs.existsSync(payload.files[0].attachment));
    const all = components(panel);
    assert.ok(all.length <= 40);
    const text = all
      .filter((item) => item.type === ComponentType.TextDisplay)
      .map((item) => item.content)
      .join('\n');
    assert.ok(text.length <= 4000);
    const buttons = all.filter((item) => item.type === ComponentType.Button);
    assert.deepEqual(
      buttons.filter((button) => button.style === ButtonStyle.Link).map((button) => button.url),
      Object.values(links),
    );
    assert.equal(
      buttons.filter((button) => button.custom_id?.startsWith('sservice:socials:language:')).length,
      1,
    );
    for (const row of all.filter((item) => item.type === ComponentType.ActionRow))
      assert.ok(row.components.length <= 5);
  }
  const noIcon = createSocials.buildSocialsPayload({ ...f.guild, iconURL: () => null });
  assert.doesNotThrow(() => noIcon.components[0].toJSON());
});

test('publishing updates the same panel and restores its identity after restart', async (t) => {
  const f = fixture(t);
  await publish(f);
  await f.feature.execute(f.interaction());
  assert.equal(f.channel.posts.length, 1);
  assert.equal(f.channel.posts[0].edits, 1);
  const saved = JSON.parse(fs.readFileSync(f.statePath));
  assert.equal(saved.panelMessageId, f.channel.posts[0].id);
  const restarted = createSocials({ guildId: ids.guild, statePath: f.statePath });
  await restarted.initialize(f.client);
  const status = f.interaction({ subcommand: 'status' });
  await restarted.execute(status);
  assert.match(status.replies[0].content, new RegExp(saved.panelMessageId));
  assert.match(status.replies[0].content, /sservice01/);
  await restarted.execute(f.interaction());
  assert.equal(f.channel.posts.length, 1);
  assert.equal(f.channel.posts[0].edits, 2);
});

test('ordinary members receive a private translation without changing or duplicating the public panel', async (t) => {
  const f = fixture(t);
  await publish(f);
  const translation = f.interaction({
    kind: 'button',
    customId: 'sservice:socials:language:de',
    admin: false,
  });
  assert.equal(f.feature.handlesInteraction(translation), true);
  await f.feature.handleButton(translation);
  assert.equal(translation.deferred.flags, MessageFlags.Ephemeral);
  assert.match(
    JSON.stringify(translation.replies[0].components[0].toJSON()),
    /Bleib mit S-Service verbunden/,
  );
  assert.equal(f.channel.posts.length, 1);
  assert.equal(f.channel.posts[0].edits, 0);
  for (const overrides of [
    { authorId: ids.other },
    { selectedChannel: f.channels.get(ids.other) },
  ]) {
    const invalid = f.interaction({
      kind: 'button',
      customId: 'sservice:socials:language:de',
      ...overrides,
    });
    await f.feature.handleButton(invalid);
    assert.equal(invalid.deferred, null);
    assert.match(invalid.replies[0].content, /not active/);
  }
  assert.equal(
    f.feature.handlesInteraction(
      f.interaction({ kind: 'button', customId: 'sservice:rules:language:de' }),
    ),
    false,
  );
});

test('moving the managed Socials panel removes the old managed message, and deleted panels can be recreated', async (t) => {
  const f = fixture(t);
  await publish(f);
  const other = f.channels.get(ids.other);
  await f.feature.execute(f.interaction({ selectedChannel: other }));
  assert.equal(f.channel.posts[0].deleted, true);
  assert.equal(other.posts.length, 1);
  await other.posts[0].delete();
  await f.feature.execute(f.interaction({ selectedChannel: other }));
  assert.equal(other.posts.length, 2);
  assert.equal(other.messages.size, 1);
});

test('invalid links, non-admins and missing attachment permissions cannot publish a panel', async (t) => {
  const f = fixture(t);
  await f.feature.initialize(f.client);
  const denied = f.interaction({ admin: false });
  await f.feature.execute(denied);
  assert.match(denied.replies[0].content, /administrators/);
  assert.equal(denied.deferred, null);
  f.channel.permissionsFor = () => ({ has: (bit) => bit !== PermissionFlagsBits.AttachFiles });
  const originalError = console.error;
  console.error = () => {};
  try {
    const noFiles = f.interaction();
    await f.feature.execute(noFiles);
    assert.match(noFiles.replies[0].content, /AttachFiles/);
  } finally {
    console.error = originalError;
  }
  assert.equal(f.channel.posts.length, 0);
  assert.equal(fs.existsSync(f.statePath), false);
  for (const bad of [
    '',
    'javascript:alert(1)',
    'http://www.youtube.com/',
    'https://user:password@www.youtube.com/',
  ]) {
    assert.throws(
      () => createSocials.validateLinks({ ...links, youtube: bad }),
      /HTTPS youtube URL/,
    );
  }
  assert.throws(() => createSocials.validateLinks({}), /HTTPS tebex URL/);
});

test('Socials slash command uses create with optional channel and administrator access', (t) => {
  const f = fixture(t);
  const command = f.feature.data[0].toJSON();
  assert.equal(command.name, 'socials');
  assert.equal(command.default_member_permissions, PermissionFlagsBits.Administrator.toString());
  assert.equal(
    command.options.find((option) => option.name === 'create').options[0].required,
    false,
  );
});
