const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const vm = require('node:vm');
const { loadConfig } = require('../src/config');
const { loadJsonConfig } = require('../src/core/json-config');
const { loadTicketConfig } = require('../src/core/ticket-config');
const { createInteractionRouter } = require('../src/core/interaction-router');
const { MessageFlags } = require('discord.js');

const GUILD_ID = '100000000000000001';

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sservice-core-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('runtime configuration reads only supplied environment values and validates required fields', () => {
  const config = loadConfig({ DISCORD_TOKEN: ' fixture-token ', DISCORD_GUILD_ID: GUILD_ID });
  assert.equal(config.token, 'fixture-token');
  assert.equal(config.guildId, GUILD_ID);
  assert.equal(config.honeypotEnabled, false);
  assert.equal(config.messageContentEnabled, true);
  assert.equal(
    loadConfig({
      DISCORD_TOKEN: 'fixture',
      DISCORD_GUILD_ID: GUILD_ID,
      HONEYPOT_ENABLED: 'true',
      MESSAGE_CONTENT_ENABLED: 'false',
    }).messageContentEnabled,
    false,
  );
  assert.throws(() => loadConfig({}), /DISCORD_TOKEN/);
  assert.throws(() => loadConfig({ DISCORD_TOKEN: 'fixture' }), /DISCORD_GUILD_ID/);
  assert.throws(
    () =>
      loadConfig({
        DISCORD_TOKEN: 'fixture',
        DISCORD_GUILD_ID: GUILD_ID,
        HONEYPOT_ENABLED: 'perhaps',
      }),
    /must be true or false/,
  );
});

test('JSON configuration falls back to examples, uses local settings, and rejects malformed files', (t) => {
  const directory = temporaryDirectory(t);
  fs.writeFileSync(path.join(directory, 'sample.example.json'), JSON.stringify({ enabled: false }));
  assert.equal(loadJsonConfig('sample', directory).enabled, false);
  fs.writeFileSync(path.join(directory, 'sample.json'), JSON.stringify({ enabled: true }));
  assert.equal(loadJsonConfig('sample', directory).enabled, true);
  fs.writeFileSync(path.join(directory, 'sample.json'), '{broken');
  assert.throws(() => loadJsonConfig('sample', directory), /Check its JSON/);
  assert.throws(() => loadJsonConfig('../sample', directory), /Invalid configuration/);
});

test('ticket settings inherit the team role and keep server IDs out of code', (t) => {
  const directory = temporaryDirectory(t);
  const example = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../config/tickets.example.json')),
  );
  fs.writeFileSync(path.join(directory, 'tickets.example.json'), JSON.stringify(example));
  assert.equal(loadTicketConfig(directory).teamRoleId, '');
  const local = {
    ...example,
    teamRoleId: '200000000000000002',
    categories: {
      ...example.categories,
      'customer-support': { categoryId: '300000000000000003', roleId: '' },
    },
  };
  fs.writeFileSync(path.join(directory, 'tickets.json'), JSON.stringify(local));
  const config = loadTicketConfig(directory);
  assert.equal(config.categories['customer-support'].categoryId, '300000000000000003');
  assert.equal(config.categories['customer-support'].roleId, local.teamRoleId);
  fs.writeFileSync(
    path.join(directory, 'tickets.json'),
    JSON.stringify({ ...local, teamRoleId: 123 }),
  );
  assert.throws(() => loadTicketConfig(directory), /Discord ID string/);
});

function ticketWithSettings(settings) {
  const file = path.join(__dirname, '../src/modules/ticket.js');
  const localRequire = createRequire(file);
  const exported = { exports: {} };
  const sandbox = {
    module: exported,
    exports: exported.exports,
    __dirname: path.dirname(file),
    Buffer,
    console,
    setTimeout,
    clearTimeout,
    require: (name) =>
      name === '../core/ticket-config' ? { loadTicketConfig: () => settings } : localRequire(name),
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  return exported.exports;
}

test('ticket panel requires admin access and complete configuration before publishing', async () => {
  const settings = loadTicketConfig();
  const blank = {
    teamRoleId: '',
    logChannelId: '',
    categories: Object.fromEntries(
      Object.keys(settings.categories).map((key) => [key, { categoryId: '', roleId: '' }]),
    ),
  };
  const ticket = ticketWithSettings(blank);
  const makeInteraction = (admin) => ({
    commandName: 'setup',
    guildId: GUILD_ID,
    inGuild: () => true,
    memberPermissions: { has: () => admin },
    options: { getSubcommand: () => 'tickets' },
    replies: [],
    channel: {
      async send() {
        throw new Error('Must not publish before validation');
      },
    },
    async reply(payload) {
      this.replies.push(payload);
    },
  });
  const denied = makeInteraction(false);
  await ticket.execute(denied);
  assert.match(denied.replies[0].content, /administrators/);
  const unconfigured = makeInteraction(true);
  await ticket.execute(unconfigured);
  assert.match(unconfigured.replies[0].content, /config\/tickets.json/);
  assert.equal(unconfigured.replies[0].flags, MessageFlags.Ephemeral);
});

test('configured ticket panels attach the local banner after deferring the command', async () => {
  const template = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../config/tickets.example.json')),
  );
  const settings = {
    teamRoleId: '200000000000000002',
    logChannelId: '',
    categories: Object.fromEntries(
      Object.keys(template.categories).map((key, index) => [
        key,
        { categoryId: String(300000000000000000n + BigInt(index)), roleId: '200000000000000002' },
      ]),
    ),
  };
  const ticket = ticketWithSettings(settings);
  let deferred = false;
  let sent;
  const interaction = {
    commandName: 'setup',
    guildId: GUILD_ID,
    inGuild: () => true,
    memberPermissions: { has: () => true },
    options: { getSubcommand: () => 'tickets' },
    async deferReply() {
      deferred = true;
    },
    channel: {
      async send(payload) {
        assert.equal(deferred, true);
        sent = payload;
      },
    },
    async editReply() {},
  };
  await ticket.execute(interaction);
  assert.ok(fs.existsSync(sent.files[0].attachment));
  assert.equal(
    sent.components[0].toJSON().components[0].items[0].media.url,
    'attachment://banner_welcome.png',
  );
});

function routerFixture() {
  const calls = [];
  const call = (name) => async () => calls.push(name);
  const ticket = {
    data: [{ toJSON: () => ({ name: 'setup' }) }],
    execute: call('setup'),
    TICKET_PRIORITY_BUTTON_PREFIX: 'priority:',
    TICKET_MODAL_ID_PREFIX: 'ticket:',
    TICKET_CATEGORY_SELECT_ID: 'category',
    handlePriorityButton: call('priority'),
    handleModalSubmit: call('ticket-modal'),
    handleSelectMenu: call('category'),
  };
  for (const [field, handler] of [
    ['CLOSE_BUTTON', 'CloseButton'],
    ['CONTROL_BUTTON', 'ControlButton'],
    ['CLAIM_BUTTON', 'ClaimButton'],
    ['FEEDBACK_BUTTON', 'FeedbackButton'],
    ['ADD_USER_BUTTON', 'AddUserButton'],
    ['RENAME_BUTTON', 'RenameButton'],
    ['ADD_USER_MODAL', 'AddUserModal'],
    ['RENAME_MODAL', 'RenameModal'],
  ]) {
    ticket[`TICKET_${field}_ID`] = field;
    ticket[`handle${handler}`] = call(handler);
  }
  const feature = {
    data: [{ toJSON: () => ({ name: 'socials' }) }],
    execute: call('socials'),
    handlesInteraction: (i) => i.customId === 'translation',
    handleButton: call('translation'),
  };
  const router = createInteractionRouter({ guildId: GUILD_ID, modules: [ticket, feature], ticket });
  const interaction = (kind, customId, overrides = {}) => ({
    guildId: GUILD_ID,
    inGuild: () => true,
    customId,
    commandName: customId,
    isChatInputCommand: () => kind === 'command',
    isButton: () => kind === 'button',
    isModalSubmit: () => kind === 'modal',
    isStringSelectMenu: () => kind === 'select',
    ...overrides,
  });
  return { router, interaction, calls, ticket, feature };
}

test('interaction routing preserves slash, feature, button, modal, and select handlers', async () => {
  const f = routerFixture();
  const routes = [
    ['command', 'setup'],
    ['command', 'socials'],
    ['button', 'translation'],
    ['button', 'CLOSE_BUTTON'],
    ['button', 'CONTROL_BUTTON'],
    ['button', 'CLAIM_BUTTON'],
    ['button', 'FEEDBACK_BUTTON'],
    ['button', 'ADD_USER_BUTTON'],
    ['button', 'RENAME_BUTTON'],
    ['button', 'priority:high'],
    ['modal', 'ADD_USER_MODAL'],
    ['modal', 'RENAME_MODAL'],
    ['modal', 'ticket:question'],
    ['select', 'category'],
  ];
  for (const [kind, id] of routes)
    assert.equal(await f.router.dispatch(f.interaction(kind, id)), true);
  assert.equal(f.calls.length, routes.length);
  assert.equal(await f.router.dispatch(f.interaction('button', 'unknown')), false);
  assert.equal(await f.router.dispatch(f.interaction('command', 'unknown')), false);
});

test('interaction router rejects other guilds, direct messages, and duplicate command names', async () => {
  const f = routerFixture();
  assert.equal(
    await f.router.dispatch(f.interaction('command', 'setup', { guildId: '900000000000000009' })),
    false,
  );
  assert.equal(
    await f.router.dispatch(f.interaction('command', 'setup', { inGuild: () => false })),
    false,
  );
  assert.equal(f.calls.length, 0);
  assert.throws(
    () =>
      createInteractionRouter({
        guildId: GUILD_ID,
        modules: [f.ticket, f.ticket],
        ticket: f.ticket,
      }),
    /Duplicate command/,
  );
});
