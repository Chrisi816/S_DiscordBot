const { loadConfig, loadEnvironment } = require('./config');

try {
  loadEnvironment();
  const config = loadConfig();
  const { createBot } = require('./bot');
  const client = createBot(config);
  const shutdown = async () => {
    await client.destroy();
    process.exitCode = 0;
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  client.login(config.token).catch(async (error) => {
    console.error('Bot login failed:', error.message);
    await client.destroy();
    process.exitCode = 1;
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
