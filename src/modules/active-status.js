const { ActivityType } = require('discord.js');

const STATUS_INTERVAL_MS = 15_000;

let statusInterval = null;
let startTimestamp = Date.now();

function formatUptime(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function buildStatusTexts() {
  const uptime = formatUptime(Date.now() - startTimestamp);

  return ['🚀 s-service.tebex.io', '🚀 Since 2022', `🚀 Uptime: ${uptime}`];
}

async function applyStatus(client, text) {
  if (!client?.user) return;

  try {
    await client.user.setPresence({
      status: 'online',
      activities: [
        {
          type: ActivityType.Playing,
          name: text,
        },
      ],
    });
  } catch (error) {
    console.error('Failed to update active status:', error);
  }
}

function initializeActiveStatus(client) {
  if (!client?.user) return;
  if (statusInterval) clearInterval(statusInterval);

  startTimestamp = client.readyTimestamp || Date.now();

  let currentIndex = 0;

  const rotate = async () => {
    const statuses = buildStatusTexts();
    const nextStatus = statuses[currentIndex % statuses.length];
    currentIndex += 1;
    await applyStatus(client, nextStatus);
  };

  rotate().catch(() => {});
  statusInterval = setInterval(() => {
    rotate().catch(() => {});
  }, STATUS_INTERVAL_MS);
  statusInterval.unref?.();
}

module.exports = {
  initializeActiveStatus,
};
