const { loadJsonConfig } = require('./json-config');

const CATEGORY_NAMES = [
  'question-ticket',
  'customer-support',
  'purchase-support',
  'staff-application',
  'partner-program',
  'redeem-giveaway',
];

function readId(value, field) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || !/^\d{17,20}$/.test(value)) {
    throw new Error(`Set ${field} to a Discord ID string in config/tickets.json.`);
  }
  return value;
}

function loadTicketConfig(directory) {
  const settings = loadJsonConfig('tickets', directory);
  const teamRoleId = readId(settings.teamRoleId, 'teamRoleId');
  const logChannelId = readId(settings.logChannelId, 'logChannelId');
  const categories = Object.fromEntries(
    CATEGORY_NAMES.map((name) => {
      const category = settings.categories?.[name] ?? {};
      return [
        name,
        {
          categoryId: readId(category.categoryId, `categories.${name}.categoryId`),
          roleId: readId(category.roleId, `categories.${name}.roleId`) || teamRoleId,
        },
      ];
    }),
  );
  return { teamRoleId, logChannelId, categories };
}

module.exports = { loadTicketConfig };
