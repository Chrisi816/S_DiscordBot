# Setup & Operations

## Environment

Node.js 22 or newer is required. `.nvmrc` selects Node.js 24. The bot loads `.env` through Node.js and reads the following variables:

| Variable                  | Required | Default | Purpose                                                  |
| ------------------------- | -------- | ------- | -------------------------------------------------------- |
| `DISCORD_TOKEN`           | Yes      | None    | Bot token from the Discord Developer Portal              |
| `DISCORD_GUILD_ID`        | Yes      | None    | Server where commands and automation are enabled         |
| `HONEYPOT_ENABLED`        | No       | `false` | Registers and enables the optional honeypot module       |
| `MESSAGE_CONTENT_ENABLED` | No       | `true`  | Requests message content for complete ticket transcripts |

Boolean values are `true` or `false`. Enable the corresponding privileged intents in the Developer Portal before starting the client. If you set `MESSAGE_CONTENT_ENABLED=false`, ticket transcripts may not contain ordinary message text.

## Local configuration

| File                   | Setup                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `.env`                 | Copy `.env.example` and fill in the token and guild ID                              |
| `config/tickets.json`  | Copy `tickets.example.json` and fill in server-specific ticket roles and categories |
| `config/honeypot.json` | Optional copy of `honeypot.example.json` for the log channel and exempt roles       |
| `config/socials.json`  | Public social links; included and editable                                          |

Local ticket and honeypot files are ignored by Git. Example files contain empty IDs. IDs must be quoted strings. Ticket category entries inherit `teamRoleId` when their individual `roleId` is empty. The ticket log channel is optional.

Rules and Socials text lives in `src/modules/rules-content.js` and `src/modules/socials-content.js`. All banners are local assets. Ticket panels reuse the bundled Welcome banner, so they do not depend on an expiring Discord CDN link.

## Permissions

Give the bot permissions for the features you enable:

| Feature                   | Permissions                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Welcome, Booster, Socials | View Channel, Send Messages, Embed Links, Attach Files                                                                           |
| Managed panels            | Read Message History to locate and update the existing panel                                                                     |
| Customer counter          | View Channel and Manage Channels in the target channel/category                                                                  |
| Verification              | Manage Roles; the assigned role must be below the bot role                                                                       |
| Tickets                   | Manage Channels plus View Channel, Send Messages, Read Message History, Embed Links, Attach Files                                |
| Honeypot                  | Kick Members, Manage Messages, View Channel, Send Messages, Read Message History; the bot role must be above the affected member |

Do not select an administrator or moderation role for public captcha verification. The module rejects privileged roles. Existing member roles are retained when the verified role is added.

## Commands

| Command                 | Action                                                 |
| ----------------------- | ------------------------------------------------------ |
| `/welcome setup`        | Set welcome, announcement, and ticket channels         |
| `/welcome test`         | Send a preview without pinging the selected member     |
| `/welcome status`       | Show selected channels                                 |
| `/welcome disable`      | Stop automatic greetings                               |
| `/customerstats setup`  | Select a role and create or select a voice counter     |
| `/customerstats status` | Show the count and target channel                      |
| `/rules create`         | Post or update a combined rules/verification panel     |
| `/rules status`         | Show the panel and verified role                       |
| `/rules disable`        | Stop new verifications without removing existing roles |
| `/booster setup`        | Select the notification channel                        |
| `/booster test`         | Send a private-ping-free preview to that channel       |
| `/booster status`       | Show the channel                                       |
| `/booster disable`      | Stop boost notifications                               |
| `/socials create`       | Post or update the Socials panel                       |
| `/socials status`       | Show its panel and target URLs                         |
| `/setup tickets`        | Post the configured support panel                      |
| `/honeypot setup`       | Activate the spam-trap panel                           |
| `/honeypot status`      | Show its state and kick counter                        |

The honeypot is an active moderation feature: non-exempt members who send a message in the configured trap channel are kicked and their triggering message is deleted. Bot accounts, administrators, the server owner, and configured exempt roles are excluded.

## Behavior and limits

- Captchas contain six digits and six options. They are private, member-bound, valid for two minutes, and accept one answer. A failure causes a one-minute cooldown; three failures cause a ten-minute cooldown. Open challenges expire when the process restarts.
- Customer counts include offline members. Channel renames are grouped and may take about six minutes. A full member reconciliation runs every fifteen minutes.
- Boost notifications use Discord boost system messages. Enable those messages and make their channel visible to the bot to detect additional boosts by existing boosters. A fallback detects known members starting their first active boost, after about eight seconds. Offline events are not replayed.
- Rules and Socials remember one managed panel each. Repeating the create command in the same channel edits that panel. Moving it removes only the previous managed message.
- Runtime state is stored in `data/`. Back up this directory separately; it is not part of the source repository.

## PM2

```bash
pm2 start src/index.js --name sservice-bot
pm2 save
pm2 startup
```

Run the command printed by `pm2 startup`, then run `pm2 save` again. PM2 must be installed separately on the host.

```bash
pm2 restart sservice-bot
pm2 logs sservice-bot
```

Keep `.env`, local configuration, and `data/` when updating. Stop the old process before switching from the earlier private distribution, then start the new `src/index.js` entry point.

## Migration from the previous private package

| Previous location              | Public source version  |
| ------------------------------ | ---------------------- |
| `config.js` token and guild ID | `.env`                 |
| Ticket role/category constants | `config/tickets.json`  |
| `module/honeypot/config.json`  | `config/honeypot.json` |
| `module/socials.config.json`   | `config/socials.json`  |
| `database/*.json`              | `data/*.json`          |
| `bot.js`                       | `src/index.js`         |

Migrate local settings on your own host. The public archive contains no copy of the previous token or live server configuration. The empty `database/ticket.store.js` placeholder has been removed; ticket state continues to use Discord channel topics.
