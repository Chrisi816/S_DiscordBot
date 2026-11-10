const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  ChannelType,
  ComponentType,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  FileBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  LabelBuilder,
} = require('discord.js');
const path = require('node:path');
const { loadTicketConfig } = require('../core/ticket-config');
const { requireAdmin } = require('../core/utils');
const ticketSettings = loadTicketConfig();

const COMMAND_NAME = 'setup tickets';
const COMMAND_DESCRIPTION = 'Send the Ticket Panel';

const TICKET_BANNER_URL = 'attachment://banner_welcome.png';
const TICKET_BANNER_PATH = path.join(__dirname, '../../assets/banner_welcome.png');

const TICKET_DOCUMENTATION_URL = 'https://s-service.gitbook.io/s-service-documentations';

const TICKET_LANGUAGES = {
  en: { label: 'ENG — English', emoji: '🇬🇧' },
  de: { label: 'GER — Deutsch', emoji: '🇩🇪' },
  pl: { label: 'POL — Polski', emoji: '🇵🇱' },
};

const TICKET_AUTO_MESSAGES = {
  en: [
    "Hello, I am the automated support assistant of S-Service. Please describe your concern in as much detail as possible so that our team can get back to you directly. If you don't write anything meaningful or don't write anything at all, your ticket will be closed immediately by a team member!",
    '',
    '**Support Hours:**',
    '> Monday to Saturday: 16:00 - 22:00',
    '> Sunday: Limited support from 16:00 - 22:00',
    '> All support hours are in `CET (UTC+1)`.',
  ].join('\n'),
  de: [
    'Hallo, ich bin der automatisierte Support-Assistent von S-Service. Bitte beschreibe dein Anliegen so ausführlich wie möglich, damit unser Team direkt darauf eingehen kann. Wenn du nichts Aussagekräftiges oder gar nichts schreibst, wird dein Ticket sofort von einem Teammitglied geschlossen!',
    '',
    '**Supportzeiten:**',
    '> Montag bis Samstag: 16:00 - 22:00 Uhr',
    '> Sonntag: Eingeschränkter Support von 16:00 - 22:00 Uhr',
    '> Alle Supportzeiten gelten in `MEZ (UTC+1)`.',
  ].join('\n'),
  pl: [
    'Cześć, jestem automatycznym asystentem wsparcia S-Service. Opisz swoją sprawę jak najdokładniej, aby nasz zespół mógł od razu Ci pomóc. Jeśli nie napiszesz nic konkretnego lub w ogóle nic nie napiszesz, członek zespołu natychmiast zamknie Twoje zgłoszenie!',
    '',
    '**Godziny wsparcia:**',
    '> Od poniedziałku do soboty: 16:00 - 22:00',
    '> Niedziela: Ograniczone wsparcie od 16:00 do 22:00',
    '> Wszystkie godziny wsparcia podano w strefie `CET (UTC+1)`.',
  ].join('\n'),
};

function normalizeTicketLanguage(value) {
  const aliases = {
    en: 'en',
    eng: 'en',
    english: 'en',
    de: 'de',
    ger: 'de',
    deu: 'de',
    german: 'de',
    deutsch: 'de',
    pl: 'pl',
    pol: 'pl',
    polish: 'pl',
    polski: 'pl',
  };
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  return Object.hasOwn(aliases, normalized) ? aliases[normalized] : 'en';
}

const TICKET_TEAM_ROLE_ID = ticketSettings.teamRoleId;

const TICKET_LOG_CHANNEL_ID = ticketSettings.logChannelId;

const TICKET_ACCENT_COLOR = 0xf91c2b;

const TICKET_LOG_COLORS = {
  opened: 0x57f287,
  closed: 0xed4245,
  action: 0x5865f2,
};

const autoMessagesInFlight = new Set();
const closingTickets = new Set();
const pendingChannelNames = new Map();
const pendingClaims = new Map();

const TICKET_CATEGORY_SELECT_ID = 'ticket-category-select';
const TICKET_MODAL_ID_PREFIX = 'ticket-modal:';
const TICKET_CLOSE_BUTTON_ID = 'ticket-close';
const TICKET_CONTROL_BUTTON_ID = 'ticket-control';
const TICKET_PRIORITY_BUTTON_PREFIX = 'ticket-priority:';
const TICKET_CLAIM_BUTTON_ID = 'ticket-claim';
const TICKET_FEEDBACK_BUTTON_ID = 'ticket-feedback';
const TICKET_ADD_USER_BUTTON_ID = 'ticket-add-user';
const TICKET_ADD_USER_MODAL_ID = 'ticket-add-user-modal';
const TICKET_RENAME_BUTTON_ID = 'ticket-rename';
const TICKET_RENAME_MODAL_ID = 'ticket-rename-modal';

const TICKET_NAME_SEPARATOR = '︲';
const TICKET_PENDING_SUFFIX = '\u200B';
const TICKET_NO_PRIORITY_EMOJI = '⬜';

const TICKET_PRIORITY_LEVELS = {
  low: { label: 'Low', emoji: '🟩' },
  medium: { label: 'Medium', emoji: '🟧' },
  high: { label: 'High', emoji: '🟥' },
  done: { label: 'Done', emoji: '⬛' },
};

const FIELD_LANGUAGE = {
  id: 'language',
  label: 'Preferred Language',
  placeholder: 'Select your language...',
  options: Object.entries(TICKET_LANGUAGES).map(([value, language]) => ({
    value,
    ...language,
  })),
};
const FIELD_TBX_ID = {
  id: 'tbx-id',
  label: 'Your TBX Transaction ID',
  placeholder: 'tbx-446567899a14567-1abcde',
  style: TextInputStyle.Short,
  maxLength: 64,
};
const FIELD_EMAIL = {
  id: 'email',
  label: 'Your E-Mail Address',
  placeholder: 'The E-Mail address you used to buy the product',
  style: TextInputStyle.Short,
  maxLength: 100,
};
const FIELD_CFX = {
  id: 'cfx-account',
  label: 'CFX Account',
  placeholder: 'Your CFX Account Name (only if you want to buy a script)',
  style: TextInputStyle.Short,
  maxLength: 100,
  required: false,
};
const FIELD_POSITION = {
  id: 'position',
  label: 'Position',
  placeholder: 'What are you applying for?',
  style: TextInputStyle.Short,
  maxLength: 100,
};
const FIELD_APPLICATION = {
  id: 'application',
  label: 'Application',
  placeholder: 'Tell us something about yourself...\n[name, age, experience, ...]',
  style: TextInputStyle.Paragraph,
  maxLength: 1000,
};
const FIELD_INVITE = {
  id: 'invite-link',
  label: 'Your Discord Invite Link',
  placeholder: 'https://discord.gg/s-service',
  style: TextInputStyle.Short,
  maxLength: 100,
};
const FIELD_MEMBER_COUNT = {
  id: 'member-count',
  label: 'Member Count',
  placeholder: 'How many members are on your server?',
  style: TextInputStyle.Short,
  maxLength: 20,
};
const FIELD_INFORMATION = {
  id: 'information',
  label: 'Information',
  placeholder: 'Tell us more about your Server/Organization',
  style: TextInputStyle.Paragraph,
  maxLength: 1000,
};
const FIELD_CFX_REDEEM = { ...FIELD_CFX, placeholder: 'Your CFX Account Name' };
const FIELD_GIVEAWAY_TYPE = {
  id: 'giveaway-type',
  label: 'Giveaway Type',
  placeholder: 'What did you win?',
  style: TextInputStyle.Paragraph,
  maxLength: 500,
};
const FIELD_REASON = {
  id: 'reason',
  label: 'Ticket Reason',
  placeholder: 'Information that can help us resolve this ticket',
  style: TextInputStyle.Paragraph,
  maxLength: 1000,
};

const TICKET_CATEGORIES = [
  {
    value: 'question-ticket',
    slug: 'question-ticket',
    categoryId: ticketSettings.categories['question-ticket'].categoryId,
    roleId: ticketSettings.categories['question-ticket'].roleId,
    label: 'Question Ticket',
    emoji: '❓',
    description: 'Only for questions for non customers!',
    fields: [FIELD_LANGUAGE, FIELD_REASON],
  },
  {
    value: 'customer-support',
    slug: 'customer-support',
    categoryId: ticketSettings.categories['customer-support'].categoryId,
    roleId: ticketSettings.categories['customer-support'].roleId,
    label: 'Customer Support',
    emoji: '🛠️',
    description: 'Only for verified customers to get script support!',
    fields: [FIELD_LANGUAGE, FIELD_TBX_ID, FIELD_EMAIL, FIELD_REASON],
  },
  {
    value: 'purchase-support',
    slug: 'purchase-support',
    categoryId: ticketSettings.categories['purchase-support'].categoryId,
    roleId: ticketSettings.categories['purchase-support'].roleId,
    label: 'Purchase Support',
    emoji: '🛒',
    description: 'If you want to buy something open a purchase ticket!',
    modalTitle: 'Purchase Ticket',
    fields: [FIELD_LANGUAGE, FIELD_CFX, FIELD_REASON],
  },
  {
    value: 'staff-application',
    slug: 'staff-application',
    categoryId: ticketSettings.categories['staff-application'].categoryId,
    roleId: ticketSettings.categories['staff-application'].roleId,
    label: 'Staff Application',
    emoji: '🫂',
    description: 'If you want to send an application open a application ticket!',
    modalTitle: 'Staff Ticket',
    fields: [FIELD_LANGUAGE, FIELD_POSITION, FIELD_APPLICATION],
  },
  {
    value: 'partner-program',
    slug: 'partner-program',
    categoryId: ticketSettings.categories['partner-program'].categoryId,
    roleId: ticketSettings.categories['partner-program'].roleId,
    label: 'Partner Program',
    emoji: '🤝',
    description: 'If you want to send a partnership request open a partner ticket!',
    fields: [FIELD_LANGUAGE, FIELD_INVITE, FIELD_MEMBER_COUNT, FIELD_INFORMATION],
  },
  {
    value: 'redeem-giveaway',
    slug: 'redeem-giveaway',
    categoryId: ticketSettings.categories['redeem-giveaway'].categoryId,
    roleId: ticketSettings.categories['redeem-giveaway'].roleId,
    label: 'Redeem Giveaway',
    emoji: '🎁',
    description: 'Click this option if you have won a giveaway!',
    modalTitle: 'Redeem Ticket',
    fields: [FIELD_LANGUAGE, FIELD_CFX_REDEEM, FIELD_GIVEAWAY_TYPE],
  },
];

const [BASE_NAME, SUBCOMMAND_NAME] = COMMAND_NAME.split(' ');

const data = [
  new SlashCommandBuilder()
    .setName(BASE_NAME)
    .setDescription(COMMAND_DESCRIPTION)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand.setName(SUBCOMMAND_NAME).setDescription(COMMAND_DESCRIPTION),
    ),
];

function buildTicketPanel() {
  const container = new ContainerBuilder()
    .setAccentColor(TICKET_ACCENT_COLOR)
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(TICKET_BANNER_URL)),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('## 📨 Ticket System'))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        '> Welcome to the Ticket System\n> Please select a fitting category from the dropdown below to start your ticket request.',
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          '**📚 Before opening a ticket**',
          '> Check our documentation and typical errors first. Send feature suggestions to the suggestions channel.',
          `> [Documentation](${TICKET_DOCUMENTATION_URL})`,
        ].join('\n'),
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          '**Available Categories:**',
          '- ❓Question Ticket',
          '- 🛠️ Customer Support',
          '- 🛒 Purchase Support',
          '- 🫂Staff Application',
          '- 🤝Partner Programm',
          '- 🎁Redeem Giveaway',
        ].join('\n'),
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        '**Important:** If a ticket is inappropriate, unclear, or contains spam, we reserve the right to close it immediately without comment or further explanation.',
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(TICKET_CATEGORY_SELECT_ID)
          .setPlaceholder('Select a category...')
          .addOptions(
            TICKET_CATEGORIES.map((category) => ({
              label: category.label,
              value: category.value,
              description: category.description,
              emoji: category.emoji,
            })),
          ),
      ),
    );

  return container;
}

function buildTicketAnswers(category, answers) {
  return category.fields
    .map((field) => {
      const value =
        field.id === FIELD_LANGUAGE.id
          ? TICKET_LANGUAGES[normalizeTicketLanguage(answers[field.id])].label
          : answers[field.id] || '*-*';
      return `**${field.label}:**\n${value}`;
    })
    .join('\n\n');
}

function buildTicketWelcome(category, user, answers = null) {
  const container = new ContainerBuilder()
    .setAccentColor(TICKET_ACCENT_COLOR)
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(TICKET_BANNER_URL)),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('## 👋 Welcome to your ticket'))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `- Team Ping: ${category.roleId ? `<@&${category.roleId}>` : '*No team role configured*'}`,
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `- Hey ${user}, thank you for reaching out. Your conversation has been started, and a team member will be with you shortly.`,
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder());

  if (answers && category.fields) {
    container
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(buildTicketAnswers(category, answers)),
      )
      .addSeparatorComponents(new SeparatorBuilder());
  }

  return container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(TICKET_CLOSE_BUTTON_ID)
        .setLabel('Close Ticket')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(TICKET_CONTROL_BUTTON_ID)
        .setLabel('Control')
        .setEmoji('🛡️')
        .setStyle(ButtonStyle.Secondary),
    ),
  );
}

async function execute(interaction) {
  if (
    interaction.commandName !== BASE_NAME ||
    interaction.options.getSubcommand() !== SUBCOMMAND_NAME
  )
    return;
  if (!(await requireAdmin(interaction, interaction.guildId))) return;
  if (!TICKET_TEAM_ROLE_ID || TICKET_CATEGORIES.some((category) => !category.categoryId)) {
    await interaction.reply({
      content:
        'Configure your team role and all six ticket categories in config/tickets.json, then restart the bot.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await interaction.channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [buildTicketPanel()],
      files: [new AttachmentBuilder(TICKET_BANNER_PATH, { name: 'banner_welcome.png' })],
      allowedMentions: { parse: [] },
    });
    await interaction.editReply('✅ Ticket panel successfully sent.');
  } catch (error) {
    console.error('Ticket panel publishing failed:', error);
    await interaction.editReply(
      'Could not publish the ticket panel. Check the bot permissions and configuration.',
    );
  }
}

function findExistingTicket(interaction, category) {
  return interaction.guild.channels.cache.find((channel) => {
    if (channel.parentId !== category.categoryId) return false;
    return parseTicketTopic(channel)?.ownerId === interaction.user.id;
  });
}

async function rejectTicketOpen(interaction, category) {
  if (!category?.categoryId) {
    await interaction.reply({
      content: '❌ Category not currently set!',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const existingTicket = findExistingTicket(interaction, category);

  if (existingTicket) {
    await interaction.reply({
      content: `❌ You already have an open ticket in this category: ${existingTicket}`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  return false;
}

function buildTicketModal(category) {
  return new ModalBuilder()
    .setCustomId(`${TICKET_MODAL_ID_PREFIX}${category.value}`)
    .setTitle(category.modalTitle ?? category.label)
    .addLabelComponents(
      category.fields.map((field) => {
        const label = new LabelBuilder().setLabel(field.label);
        if (field.options) {
          return label.setStringSelectMenuComponent(
            new StringSelectMenuBuilder()
              .setCustomId(field.id)
              .setPlaceholder(field.placeholder)
              .setMinValues(1)
              .setMaxValues(1)
              .setRequired(field.required ?? true)
              .addOptions(field.options),
          );
        }
        return label.setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(field.id)
            .setPlaceholder(field.placeholder)
            .setStyle(field.style)
            .setMaxLength(field.maxLength)
            .setRequired(field.required ?? true),
        );
      }),
    );
}

async function handleSelectMenu(interaction) {
  if (interaction.customId !== TICKET_CATEGORY_SELECT_ID) return;

  const category = TICKET_CATEGORIES.find((entry) => entry.value === interaction.values[0]);

  if (await rejectTicketOpen(interaction, category)) return;

  if (category.fields) {
    await interaction.showModal(buildTicketModal(category));
    return;
  }

  await createTicket(interaction, category);
}

async function handleModalSubmit(interaction) {
  if (!interaction.customId.startsWith(TICKET_MODAL_ID_PREFIX)) return;

  const value = interaction.customId.slice(TICKET_MODAL_ID_PREFIX.length);
  const category = TICKET_CATEGORIES.find((entry) => entry.value === value);

  if (!category?.fields) return;
  if (await rejectTicketOpen(interaction, category)) return;

  const answers = Object.fromEntries(
    category.fields.map((field) => {
      const value =
        field.options &&
        interaction.fields.fields.get(field.id)?.type === ComponentType.StringSelect
          ? interaction.fields.getStringSelectValues(field.id)[0]
          : interaction.fields.getTextInputValue(field.id).trim();
      return [field.id, field.id === FIELD_LANGUAGE.id ? normalizeTicketLanguage(value) : value];
    }),
  );

  await createTicket(interaction, category, answers);
}

async function createTicket(interaction, category, answers = null) {
  const ticketPermissions = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
  ];

  const permissionOverwrites = [
    {
      id: interaction.guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    { id: interaction.user.id, allow: ticketPermissions },
    {
      id: interaction.client.user.id,
      allow: [...ticketPermissions, PermissionFlagsBits.ManageChannels],
    },
  ];

  if (category.roleId) {
    permissionOverwrites.push({
      id: category.roleId,
      allow: ticketPermissions,
    });
  }

  const channel = await interaction.guild.channels.create({
    name: `${TICKET_NO_PRIORITY_EMOJI}${TICKET_NAME_SEPARATOR}${category.slug}-${interaction.user.username}`,
    type: ChannelType.GuildText,
    parent: category.categoryId,
    topic: buildTicketTopic(interaction.user.id, {
      pending: true,
      language: answers?.language,
    }),
    permissionOverwrites,
  });

  await channel.send({
    flags: MessageFlags.IsComponentsV2,
    components: [buildTicketWelcome(category, interaction.user, answers)],
    files: [new AttachmentBuilder(TICKET_BANNER_PATH, { name: 'banner_welcome.png' })],
    allowedMentions: { parse: ['users', 'roles'] },
  });

  await interaction.reply({
    content: `✅ Your ticket has been created: ${channel}`,
    flags: MessageFlags.Ephemeral,
  });

  await logTicketOpened(channel, interaction.user, category);
}

async function handleAddUserButton(interaction) {
  const ticket = await requireTicketAccess(interaction);
  if (!ticket) return;

  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(TICKET_ADD_USER_MODAL_ID)
      .setTitle('Add User')
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('User')
          .setUserSelectMenuComponent(
            new UserSelectMenuBuilder()
              .setCustomId('user')
              .setPlaceholder('Select the user to add...')
              .setMinValues(1)
              .setMaxValues(1),
          ),
      ),
  );
}

async function handleAddUserModal(interaction) {
  const ticket = await requireTicketAccess(interaction);
  if (!ticket) return;

  const targetUser = interaction.fields.getSelectedUsers('user', true).first();

  await interaction.channel.permissionOverwrites.edit(targetUser.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
  });

  await interaction.reply({
    content: `✅ ${targetUser} successfully added to the ticket.`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });

  await logTicketAction(interaction.channel, '➕ User Added', interaction.user, [
    `**Added user:** ${targetUser} (\`${targetUser.id}\`)`,
  ]);
}

function getChannelSlugPart(channelName) {
  const [, ...rest] = String(channelName || '').split(TICKET_NAME_SEPARATOR);
  return rest.join(TICKET_NAME_SEPARATOR);
}

function getCurrentChannelName(channel) {
  return pendingChannelNames.get(channel.id) ?? channel.name;
}

function getPriorityFromName(channelName) {
  const emoji = String(channelName || '').split(TICKET_NAME_SEPARATOR)[0];
  return (
    Object.keys(TICKET_PRIORITY_LEVELS).find(
      (level) => TICKET_PRIORITY_LEVELS[level].emoji === emoji,
    ) ?? null
  );
}

function applyChannelName(channel, name) {
  if (getCurrentChannelName(channel) === name) return;

  pendingChannelNames.set(channel.id, name);
  channel
    .setName(name)
    .catch((error) => console.error('Failed to rename ticket channel:', error))
    .finally(() => {
      if (pendingChannelNames.get(channel.id) === name) pendingChannelNames.delete(channel.id);
    });
}

function sanitizeChannelNamePart(value) {
  return (
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'ticket'
  );
}

async function handleRenameButton(interaction) {
  const ticket = await requireTicketAccess(interaction);
  if (!ticket) return;

  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(TICKET_RENAME_MODAL_ID)
      .setTitle('Rename Ticket')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('name')
            .setLabel('New Ticket Name')
            .setPlaceholder('e.g. script-support')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(24)
            .setRequired(true),
        ),
      ),
  );
}

async function handleRenameModal(interaction) {
  const ticket = await requireTicketAccess(interaction);
  if (!ticket) return;

  const currentName = getCurrentChannelName(interaction.channel);
  const currentEmoji = currentName.split(TICKET_NAME_SEPARATOR)[0] || TICKET_NO_PRIORITY_EMOJI;
  const categorySlug = ticket.category?.slug ?? getChannelSlugPart(currentName).split('-')[0];
  const newName = sanitizeChannelNamePart(interaction.fields.getTextInputValue('name'));

  applyChannelName(
    interaction.channel,
    `${currentEmoji}${TICKET_NAME_SEPARATOR}${categorySlug}-${newName}`,
  );

  await interaction.reply({
    content: `✅ Ticket successfully renamed to **${newName}**.`,
    flags: MessageFlags.Ephemeral,
  });

  await logTicketAction(interaction.channel, '✏️ Ticket Renamed', interaction.user, [
    `**Old name:** \`${currentName}\``,
    `**New name:** \`${getCurrentChannelName(interaction.channel)}\``,
  ]);
}

function buildTicketTopic(ownerId, { pending = false, claimedBy = null, language = 'en' } = {}) {
  return `Ticket by ${ownerId}${claimedBy ? ` | Claimed by ${claimedBy}` : ''} | Language ${normalizeTicketLanguage(language)}${pending ? TICKET_PENDING_SUFFIX : ''}`;
}

function parseTicketTopic(channel) {
  const topic = channel?.topic ?? '';
  const match = topic.match(/^Ticket by (\d+)(?: \| Claimed by (\d+))?/);
  if (!match) return null;

  const slugPart = getChannelSlugPart(getCurrentChannelName(channel));

  return {
    category: TICKET_CATEGORIES.find((entry) => slugPart.startsWith(entry.slug)) ?? null,
    ownerId: match[1],
    claimedBy: match[2] ?? null,
    language: normalizeTicketLanguage(topic.match(/ \| Language (en|de|pl)\b/)?.[1]),
    pending: topic.endsWith(TICKET_PENDING_SUFFIX),
  };
}

function getClaimedBy(channel, ticket) {
  return pendingClaims.has(channel.id) ? pendingClaims.get(channel.id) : ticket.claimedBy;
}

function applyClaim(channel, ticket, claimedBy) {
  pendingClaims.set(channel.id, claimedBy);
  channel
    .setTopic(
      buildTicketTopic(ticket.ownerId, {
        pending: ticket.pending,
        claimedBy,
        language: ticket.language,
      }),
    )
    .catch((error) => console.error('Failed to update ticket claim:', error))
    .finally(() => {
      if (pendingClaims.get(channel.id) === claimedBy) pendingClaims.delete(channel.id);
    });
}

async function handleMessage(message) {
  if (message.author.bot || !message.inGuild()) return;

  const ticket = parseTicketTopic(message.channel);
  if (!ticket || !ticket.pending || ticket.ownerId !== message.author.id) return;
  if (autoMessagesInFlight.has(message.channel.id)) return;

  autoMessagesInFlight.add(message.channel.id);
  try {
    await message.channel.send({
      content: TICKET_AUTO_MESSAGES[ticket.language],
      allowedMentions: { parse: [] },
    });
    await message.channel.setTopic(
      buildTicketTopic(ticket.ownerId, {
        claimedBy: getClaimedBy(message.channel, ticket),
        language: ticket.language,
      }),
    );
  } finally {
    autoMessagesInFlight.delete(message.channel.id);
  }
}

function hasTeamAccess(interaction, ticket) {
  return (
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
    [TICKET_TEAM_ROLE_ID, ticket?.category?.roleId].some(
      (roleId) => roleId && interaction.member.roles.cache.has(roleId),
    )
  );
}

async function requireTicketAccess(interaction) {
  const ticket = parseTicketTopic(interaction.channel);

  if (!ticket) {
    await interaction.reply({
      content: '❌ This can only be used inside a ticket channel.',
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  if (!hasTeamAccess(interaction, ticket)) {
    await interaction.reply({
      content: '❌ You do not have permission to use this.',
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  return ticket;
}

async function handleControlButton(interaction) {
  const ticket = await requireTicketAccess(interaction);
  if (!ticket) return;

  const currentPriority = getPriorityFromName(getCurrentChannelName(interaction.channel));
  const isClaimed = Boolean(getClaimedBy(interaction.channel, ticket));

  const container = new ContainerBuilder()
    .setAccentColor(TICKET_ACCENT_COLOR)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('## 🛡️ Ticket Control'))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('> Manage this ticket using the buttons below.'),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('**🚦 Priority**'))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        Object.entries(TICKET_PRIORITY_LEVELS).map(([value, meta]) =>
          new ButtonBuilder()
            .setCustomId(`${TICKET_PRIORITY_BUTTON_PREFIX}${value}`)
            .setLabel(meta.label)
            .setEmoji(meta.emoji)
            .setStyle(value === currentPriority ? ButtonStyle.Primary : ButtonStyle.Secondary),
        ),
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('**🤖 Actions**'))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(TICKET_CLAIM_BUTTON_ID)
          .setLabel(isClaimed ? 'Unclaim' : 'Claim')
          .setEmoji('👮‍♂️')
          .setStyle(isClaimed ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(TICKET_ADD_USER_BUTTON_ID)
          .setLabel('Add User')
          .setEmoji('➕')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(TICKET_RENAME_BUTTON_ID)
          .setLabel('Rename Ticket')
          .setEmoji('✏️')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(TICKET_FEEDBACK_BUTTON_ID)
          .setLabel('Toggle Feedback')
          .setEmoji('💞')
          .setStyle(ButtonStyle.Secondary),
      ),
    );

  await interaction.reply({
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components: [container],
  });
}

async function handleClaimButton(interaction) {
  const ticket = await requireTicketAccess(interaction);
  if (!ticket) return;

  const claimedBy = getClaimedBy(interaction.channel, ticket);
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

  if (claimedBy && claimedBy !== interaction.user.id && !isAdmin) {
    await interaction.reply({
      content: `❌ This ticket is already claimed by <@${claimedBy}>.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  const claiming = !claimedBy;

  applyClaim(interaction.channel, ticket, claiming ? interaction.user.id : null);

  await interaction.reply({
    content: claiming
      ? `${interaction.user} has claimed this ticket and will be assisting you.`
      : `${interaction.user} has unclaimed this ticket.`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });

  await logTicketAction(
    interaction.channel,
    claiming ? '👮‍♂️ Ticket Claimed' : '👮‍♂️ Ticket Unclaimed',
    interaction.user,
  );
}

async function handleFeedbackButton(interaction) {
  const ticket = await requireTicketAccess(interaction);
  if (!ticket) return;

  await interaction.reply({
    content: 'Still in Work!',
    flags: MessageFlags.Ephemeral,
  });
}

async function handlePriorityButton(interaction) {
  const ticket = await requireTicketAccess(interaction);
  if (!ticket) return;

  const selectedLevel = interaction.customId.slice(TICKET_PRIORITY_BUTTON_PREFIX.length);
  const priority = TICKET_PRIORITY_LEVELS[selectedLevel];
  if (!priority) return;
  const slugPart = getChannelSlugPart(getCurrentChannelName(interaction.channel));

  applyChannelName(interaction.channel, `${priority.emoji}${TICKET_NAME_SEPARATOR}${slugPart}`);

  await interaction.reply({
    content: `✅ Priority set to ${priority.emoji} **${priority.label}**.`,
    flags: MessageFlags.Ephemeral,
  });

  await logTicketAction(interaction.channel, '🚦 Priority Changed', interaction.user, [
    `**New priority:** ${priority.emoji} ${priority.label}`,
  ]);
}

async function handleCloseButton(interaction) {
  const ticket = await requireTicketAccess(interaction);
  if (!ticket) return;

  if (closingTickets.has(interaction.channel.id)) {
    await interaction.reply({
      content: '❌ This ticket is already being closed.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  closingTickets.add(interaction.channel.id);

  await interaction.reply({
    content: '✅ The ticket has been successfully closed.',
    flags: MessageFlags.Ephemeral,
  });

  await logTicketClosed(interaction.channel, interaction.user, ticket).catch((error) =>
    console.error('Failed to log ticket close:', error),
  );

  setTimeout(() => {
    interaction.channel
      .delete()
      .catch((error) => console.error('Failed to delete ticket channel:', error))
      .finally(() => closingTickets.delete(interaction.channel.id));
  }, 5_000);
}

function formatTimestamp(ms) {
  const seconds = Math.floor(ms / 1000);
  return `<t:${seconds}:f> (<t:${seconds}:R>)`;
}

function formatDuration(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function buildLogContainer(color, title, lines) {
  return new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
}

async function getLogChannel(guild) {
  if (!TICKET_LOG_CHANNEL_ID) return null;

  const channel = await guild.channels.fetch(TICKET_LOG_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) {
    console.error(`Ticket log channel ${TICKET_LOG_CHANNEL_ID} not found or not text based.`);
    return null;
  }

  return channel;
}

async function sendLog(guild, payload) {
  const channel = await getLogChannel(guild);
  if (!channel) return;

  await channel
    .send({
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
      ...payload,
    })
    .catch((error) => console.error('Failed to send ticket log:', error));
}

async function fetchAllMessages(channel) {
  const messages = [];
  let before;

  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (batch.size === 0) break;

    messages.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }

  return messages.reverse();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function collectComponentTexts(component, texts = []) {
  if (!component || typeof component !== 'object') return texts;
  if (typeof component.content === 'string') texts.push(component.content);

  for (const child of component.components ?? []) collectComponentTexts(child, texts);
  if (component.accessory) collectComponentTexts(component.accessory, texts);

  return texts;
}

function renderMessage(message) {
  const parts = [];

  if (message.content) parts.push(`<div class="content">${escapeHtml(message.content)}</div>`);

  for (const component of message.components.map((entry) => entry.toJSON())) {
    for (const text of collectComponentTexts(component)) {
      parts.push(`<div class="content component">${escapeHtml(text)}</div>`);
    }
  }

  for (const embed of message.embeds) {
    const embedParts = [
      embed.title && `<b>${escapeHtml(embed.title)}</b>`,
      embed.description && escapeHtml(embed.description),
    ]
      .concat(
        embed.fields.map(
          (field) => `<b>${escapeHtml(field.name)}</b><br>${escapeHtml(field.value)}`,
        ),
      )
      .filter(Boolean);
    if (embedParts.length) parts.push(`<div class="embed">${embedParts.join('<br>')}</div>`);
  }

  for (const attachment of message.attachments.values()) {
    const isImage = attachment.contentType?.startsWith('image/');
    parts.push(
      isImage
        ? `<a href="${escapeHtml(attachment.url)}"><img class="attachment" src="${escapeHtml(attachment.url)}" alt="${escapeHtml(attachment.name)}"></a>`
        : `<a class="file" href="${escapeHtml(attachment.url)}">📎 ${escapeHtml(attachment.name)}</a>`,
    );
  }

  return `
	<div class="message">
		<img class="avatar" src="${escapeHtml(message.author.displayAvatarURL({ size: 64 }))}" alt="">
		<div class="body">
			<div class="header">
				<span class="author">${escapeHtml(message.member?.displayName ?? message.author.username)}</span>
				${message.author.bot ? '<span class="bot">BOT</span>' : ''}
				<span class="time">${escapeHtml(new Date(message.createdTimestamp).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }))}</span>
			</div>
			${parts.join('\n')}
		</div>
	</div>`;
}

function buildTranscriptHtml(channel, messages) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Transcript - ${escapeHtml(channel.name)}</title>
<style>
	body { background: #313338; color: #dbdee1; font-family: 'gg sans', 'Segoe UI', Arial, sans-serif; margin: 0; padding: 24px; }
	.info { background: #2b2d31; border-radius: 8px; padding: 16px; margin-bottom: 24px; }
	.info h1 { margin: 0 0 8px; font-size: 20px; color: #fff; }
	.message { display: flex; gap: 16px; padding: 8px 0; }
	.avatar { width: 40px; height: 40px; border-radius: 50%; }
	.body { flex: 1; min-width: 0; }
	.author { font-weight: 600; color: #fff; }
	.bot { background: #5865f2; color: #fff; font-size: 10px; padding: 1px 4px; border-radius: 3px; margin-left: 4px; }
	.time { color: #949ba4; font-size: 12px; margin-left: 8px; }
	.content { white-space: pre-wrap; word-wrap: break-word; margin-top: 2px; }
	.component { border-left: 3px solid #4e5058; padding-left: 8px; }
	.embed { background: #2b2d31; border-left: 4px solid #5865f2; border-radius: 4px; padding: 8px 12px; margin-top: 4px; white-space: pre-wrap; }
	.attachment { max-width: 400px; max-height: 300px; border-radius: 4px; margin-top: 4px; display: block; }
	.file { color: #00a8fc; display: block; margin-top: 4px; }
</style>
</head>
<body>
	<div class="info">
		<h1>#${escapeHtml(channel.name)}</h1>
		<div>Server: ${escapeHtml(channel.guild.name)}</div>
		<div>Messages: ${messages.length}</div>
		<div>Exported: ${escapeHtml(new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }))}</div>
	</div>
	${messages.map(renderMessage).join('\n')}
</body>
</html>`;
}

async function logTicketOpened(channel, user, category) {
  await sendLog(channel.guild, {
    components: [
      buildLogContainer(TICKET_LOG_COLORS.opened, '📂 Ticket Opened', [
        `**Ticket:** ${channel} (\`${channel.name}\`)`,
        `**Opened by:** ${user} (\`${user.id}\`)`,
        `**Category:** ${category.emoji} ${category.label}`,
        `**Opened at:** ${formatTimestamp(channel.createdTimestamp)}`,
      ]),
    ],
  });
}

async function logTicketAction(channel, title, executor, lines = []) {
  await sendLog(channel.guild, {
    components: [
      buildLogContainer(TICKET_LOG_COLORS.action, title, [
        `**Ticket:** ${channel} (\`${channel.name}\`)`,
        `**By:** ${executor} (\`${executor.id}\`)`,
        ...lines,
      ]),
    ],
  });
}

async function logTicketClosed(channel, closedBy, ticket) {
  const messages = await fetchAllMessages(channel);
  const owner = ticket?.ownerId
    ? await channel.client.users.fetch(ticket.ownerId).catch(() => null)
    : null;
  const fileName = `transcript.${owner?.username.replace(/[^a-z0-9_.-]/gi, '') || channel.id}.html`;
  const transcript = Buffer.from(buildTranscriptHtml(channel, messages), 'utf-8');
  const closedAt = Date.now();

  const container = buildLogContainer(TICKET_LOG_COLORS.closed, '🔒 Ticket Closed', [
    `**Ticket:** \`${channel.name}\``,
    `**Opened by:** ${ticket?.ownerId ? `<@${ticket.ownerId}> (\`${ticket.ownerId}\`)` : '*Unknown*'}`,
    `**Closed by:** ${closedBy} (\`${closedBy.id}\`)`,
    `**Category:** ${ticket?.category ? `${ticket.category.emoji} ${ticket.category.label}` : '*Unknown*'}`,
    `**Opened at:** ${formatTimestamp(channel.createdTimestamp)}`,
    `**Closed at:** ${formatTimestamp(closedAt)}`,
    `**Duration:** ${formatDuration(closedAt - channel.createdTimestamp)}`,
    `**Messages:** ${messages.length}`,
  ])
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('**Transcript:**'))
    .addFileComponents(new FileBuilder().setURL(`attachment://${fileName}`));

  await sendLog(channel.guild, {
    components: [container],
    files: [new AttachmentBuilder(transcript, { name: fileName })],
  });
}

module.exports = {
  data,
  execute,
  handleSelectMenu,
  handleModalSubmit,
  handleCloseButton,
  handleControlButton,
  handlePriorityButton,
  handleClaimButton,
  handleFeedbackButton,
  handleAddUserButton,
  handleAddUserModal,
  handleRenameButton,
  handleRenameModal,
  handleMessage,
  TICKET_CATEGORY_SELECT_ID,
  TICKET_MODAL_ID_PREFIX,
  TICKET_CLOSE_BUTTON_ID,
  TICKET_CONTROL_BUTTON_ID,
  TICKET_PRIORITY_BUTTON_PREFIX,
  TICKET_CLAIM_BUTTON_ID,
  TICKET_FEEDBACK_BUTTON_ID,
  TICKET_ADD_USER_BUTTON_ID,
  TICKET_ADD_USER_MODAL_ID,
  TICKET_RENAME_BUTTON_ID,
  TICKET_RENAME_MODAL_ID,
};
