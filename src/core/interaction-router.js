function createInteractionRouter({ guildId, modules, ticket }) {
  const commands = new Map();
  const definitions = [];

  for (const feature of modules) {
    for (const builder of feature.data) {
      const definition = builder.toJSON();
      if (commands.has(definition.name)) throw new Error(`Duplicate command: ${definition.name}`);
      commands.set(definition.name, feature);
      definitions.push(definition);
    }
  }

  const buttons = new Map([
    [ticket.TICKET_CLOSE_BUTTON_ID, ticket.handleCloseButton],
    [ticket.TICKET_CONTROL_BUTTON_ID, ticket.handleControlButton],
    [ticket.TICKET_CLAIM_BUTTON_ID, ticket.handleClaimButton],
    [ticket.TICKET_FEEDBACK_BUTTON_ID, ticket.handleFeedbackButton],
    [ticket.TICKET_ADD_USER_BUTTON_ID, ticket.handleAddUserButton],
    [ticket.TICKET_RENAME_BUTTON_ID, ticket.handleRenameButton],
  ]);
  const modals = new Map([
    [ticket.TICKET_ADD_USER_MODAL_ID, ticket.handleAddUserModal],
    [ticket.TICKET_RENAME_MODAL_ID, ticket.handleRenameModal],
  ]);

  async function dispatch(interaction) {
    if (!interaction.inGuild() || interaction.guildId !== guildId) return false;

    if (interaction.isChatInputCommand()) {
      const feature = commands.get(interaction.commandName);
      if (!feature) return false;
      await feature.execute(interaction);
      return true;
    }

    for (const feature of modules) {
      if (!feature.handlesInteraction?.(interaction)) continue;
      if (interaction.isButton()) await feature.handleButton(interaction);
      else await feature.handleCaptcha(interaction);
      return true;
    }

    let handler;
    if (interaction.isButton()) {
      handler = interaction.customId.startsWith(ticket.TICKET_PRIORITY_BUTTON_PREFIX)
        ? ticket.handlePriorityButton
        : buttons.get(interaction.customId);
    } else if (interaction.isModalSubmit()) {
      handler = interaction.customId.startsWith(ticket.TICKET_MODAL_ID_PREFIX)
        ? ticket.handleModalSubmit
        : modals.get(interaction.customId);
    } else if (
      interaction.isStringSelectMenu() &&
      interaction.customId === ticket.TICKET_CATEGORY_SELECT_ID
    ) {
      handler = ticket.handleSelectMenu;
    }
    if (!handler) return false;
    await handler(interaction);
    return true;
  }

  return { dispatch, definitions };
}

module.exports = { createInteractionRouter };
