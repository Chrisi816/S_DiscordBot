const fs = require('node:fs');
const path = require('node:path');

const CONFIG_DIRECTORY = path.resolve(__dirname, '../../config');

function loadJsonConfig(name, directory = CONFIG_DIRECTORY) {
  if (!/^[a-z-]+$/.test(name)) throw new Error('Invalid configuration name.');
  const local = path.join(directory, `${name}.json`);
  const example = path.join(directory, `${name}.example.json`);
  const file = fs.existsSync(local) ? local : example;
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch {
    throw new Error(`Could not read ${path.basename(file)}. Check its JSON configuration.`);
  }
}

module.exports = { loadJsonConfig };
