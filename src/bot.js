const { Client, Events, GatewayIntentBits, REST, Routes } = require('discord.js');
const { initializeActiveStatus } = require('./modules/active-status');
const { createInteractionRouter } = require('./core/interaction-router');
const ticket = require('./modules/ticket');

function createBot({ token, guildId, honeypotEnabled, messageContentEnabled }) {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
  ];
  if (messageContentEnabled) intents.push(GatewayIntentBits.MessageContent);
  const client = new Client({ intents });
  const options = { guildId };
  const welcome = require('./modules/welcome')(options);
  const booster = require('./modules/booster')(options);
  const customerStats = require('./modules/customer-stats')(options);
  const rules = require('./modules/rules')(options);
  const socials = require('./modules/socials')(options);
  const honeypot = require('./modules/honeypot')({ guildId, enabled: honeypotEnabled });
  const features = [welcome, booster, customerStats, rules, socials];
  const modules = [ticket, ...features, ...(honeypot.enabled ? [honeypot] : [])];
  const router = createInteractionRouter({ guildId, modules, ticket });

  client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}`);
    initializeActiveStatus(client);

    for (const feature of [...features, honeypot]) {
      try {
        await feature.initialize(client);
      } catch (error) {
        console.error('Module initialization failed:', error);
      }
    }

    try {
      const rest = new REST().setToken(token);
      await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), {
        body: router.definitions,
      });
      console.log('Slash commands registered.');
    } catch (error) {
      console.error('Command registration failed:', error);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      await router.dispatch(interaction);
    } catch (error) {
      console.error('Interaction failed:', error);
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.guildId !== guildId) return;
    try {
      if (await booster.handleMessage(message)) return;
      if (await honeypot.handleMessage(message)) return;
      await ticket.handleMessage(message);
    } catch (error) {
      console.error('Message handling failed:', error);
    }
  });

  return client;
}

module.exports = { createBot };
