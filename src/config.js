const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function loadEnvironment(file = path.join(PROJECT_ROOT, '.env')) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

function readBoolean(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

function loadConfig(environment = process.env) {
  const token = environment.DISCORD_TOKEN?.trim();
  const guildId = environment.DISCORD_GUILD_ID?.trim();
  if (!token) throw new Error('Set DISCORD_TOKEN in your environment or .env file.');
  if (!guildId || !/^\d{17,20}$/.test(guildId)) {
    throw new Error('Set DISCORD_GUILD_ID to a valid Discord server ID.');
  }
  return {
    token,
    guildId,
    honeypotEnabled: readBoolean(environment.HONEYPOT_ENABLED, false, 'HONEYPOT_ENABLED'),
    messageContentEnabled: readBoolean(
      environment.MESSAGE_CONTENT_ENABLED,
      true,
      'MESSAGE_CONTENT_ENABLED',
    ),
  };
}

module.exports = { loadConfig, loadEnvironment };
