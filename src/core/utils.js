const fs = require('node:fs');
const path = require('node:path');
const { PermissionFlagsBits, MessageFlags } = require('discord.js');

const SNOWFLAKE = /^\d{17,20}$/;

function createStore(file, defaults) {
  let value = { ...defaults };
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const key of Object.keys(defaults)) {
      if (typeof saved[key] !== 'string' || (saved[key] && !SNOWFLAKE.test(saved[key]))) {
        throw new Error(`Invalid ${key} in ${file}`);
      }
      value[key] = saved[key];
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return {
    get: () => ({ ...value }),
    set(next) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      fs.renameSync(`${file}.tmp`, file);
      value = { ...next };
    },
  };
}

async function requireAdmin(interaction, guildId) {
  if (
    interaction.inGuild() &&
    interaction.guildId === guildId &&
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
  )
    return true;
  await interaction.reply({
    content: '❌ Only server administrators can use this command on the S-Service server.',
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

async function requirePermissions(channel, permissions) {
  const me = channel.guild.members.me ?? (await channel.guild.members.fetchMe());
  const available = channel.permissionsFor(me);
  const missing = permissions.filter((name) => !available?.has(PermissionFlagsBits[name]));
  if (missing.length)
    throw new Error(`Missing bot permissions in ${channel}: ${missing.join(', ')}`);
}

function commandError(error) {
  if (error.code === 50013)
    return 'Missing permissions. Check the bot permissions and channel overrides.';
  if (error.code === 10003) return 'Channel not found. Run setup again with an existing channel.';
  return error.message || 'The action failed. Check the bot console.';
}

module.exports = { createStore, requireAdmin, requirePermissions, commandError };
