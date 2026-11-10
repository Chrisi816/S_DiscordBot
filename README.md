<div align="center">

# S-Service Bot

### Build your community. Simplify your workflow.

**A modular Discord bot for community management, support tickets, captcha verification, and branded server automation.**

[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=node.js&logoColor=white)](#-getting-started)
[![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?style=flat-square&logo=discord&logoColor=white)](#-tech-stack)
[![JavaScript](https://img.shields.io/badge/JavaScript-CommonJS-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](#-tech-stack)
[![License](https://img.shields.io/badge/license-ISC-F91C2B?style=flat-square)](LICENSE)

_One bot. Consistent design. A connected community._

![S-Service](assets/banner_welcome.png)

</div>

---

## ✨ About S-Service Bot

**S-Service Bot** brings the everyday tools of a Discord community into one modular application: support workflows, member onboarding, role verification, customer statistics, boost notifications, and social links.

The bot uses **Discord Components V2** to present welcome messages and community panels in a consistent S-Service design. Each feature has its own module, while shared routing, configuration, and persistence live in a small core layer.

This repository contains a working JavaScript codebase with local tests, reproducible dependency installation, formatting tools, and a GitHub Actions workflow. Running the bot requires your own Discord application, server configuration, and permissions.

## 🎯 Features

| Feature              | What it does                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| Support tickets      | Category forms, private channels, staff claims, priorities, renaming, member access, and HTML transcripts |
| Rules & verification | One combined rules panel with private image captchas and a configurable member role                       |
| Welcome messages     | Personal greetings with member avatars, account information, banners, and quick links                     |
| Customer statistics  | A role-based customer counter that includes offline members and groups channel renames                    |
| Boost notifications  | Branded booster cards with duplicate-event handling and a fallback for new boosters                       |
| Socials hub          | Tebex, YouTube, TikTok, and documentation links with private English/German translations                  |
| Honeypot             | Optional spam-trap channel that deletes triggering messages and kicks non-exempt members                  |
| Presence rotation    | Rotating server status with uptime information                                                            |

Rules and Socials translations are shown privately, keeping public channels free of duplicate panels. Captchas are member-bound, expire after two minutes, allow one answer, and apply cooldowns after failures.

## 🛠️ Tech Stack

| Area              | Technology                                         |
| ----------------- | -------------------------------------------------- |
| Runtime           | Node.js 22+; Node.js 24 recommended                |
| Language          | JavaScript / CommonJS                              |
| Discord API       | discord.js v14                                     |
| Message UI        | Discord Components V2                              |
| Captcha rendering | @napi-rs/canvas with a bundled DejaVu font         |
| Persistence       | Local JSON files with atomic replacement           |
| Testing           | Native Node.js test runner                         |
| Formatting        | Prettier                                           |
| CI                | GitHub Actions configuration for Node.js 22 and 24 |

## 🚀 Getting Started

### 1. Install dependencies

```bash
npm ci
cp .env.example .env
```

Fill in your bot token and server ID in `.env`:

```dotenv
DISCORD_TOKEN=your_discord_bot_token
DISCORD_GUILD_ID=your_discord_server_id
HONEYPOT_ENABLED=false
MESSAGE_CONTENT_ENABLED=true
```

`.env`, runtime data, and local server configuration are excluded from Git. No live token or server configuration is included in this repository.

### 2. Configure the Discord application

In the [Discord Developer Portal](https://discord.com/developers/applications), enable **Server Members Intent**. Also enable **Message Content Intent** when `MESSAGE_CONTENT_ENABLED=true`, so ticket transcripts can include message text.

Invite the bot using the `bot` and `applications.commands` scopes. Configure the permissions needed by the features you use; the bot does not require an Administrator role. For verification, its highest role must sit above the member role it assigns.

### 3. Start the bot

```bash
npm start
```

Wait for `Slash commands registered.`. Setup commands are available to server administrators.

### 4. Set up features

| Command                                                                        | Purpose                                                      |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `/welcome setup channel:#welcome announcements:#announcements ticket:#tickets` | Configure member greetings                                   |
| `/customerstats setup role:@Customer`                                          | Create or select the customer counter                        |
| `/rules create role:@Verified`                                                 | Publish rules and role verification in the current channel   |
| `/booster setup channel:#boosts`                                               | Configure boost notifications                                |
| `/socials create`                                                              | Publish the Socials hub in the current channel               |
| `/setup tickets`                                                               | Publish the ticket panel after configuring ticket categories |
| `/honeypot setup`                                                              | Enable the optional honeypot in the current channel          |

For tickets, copy `config/tickets.example.json` to `config/tickets.json`, enter your team role and the six category IDs, then restart. Enable the honeypot explicitly with `HONEYPOT_ENABLED=true` before using its command.

See [Setup & Operations](docs/SETUP.md) for all configuration fields, permissions, deployment commands, and feature limits.

## 🧱 Project Structure

| Path                 | Responsibility                                                           |
| -------------------- | ------------------------------------------------------------------------ |
| `src/index.js`       | Environment loading, startup, and shutdown                               |
| `src/bot.js`         | Discord client and feature registration                                  |
| `src/core/`          | Interaction routing, configuration loaders, and shared utilities         |
| `src/modules/`       | Tickets, onboarding, verification, statistics, notifications, and panels |
| `config/`            | Public settings and local configuration templates                        |
| `assets/`            | Banners, fonts, and third-party notices                                  |
| `data/`              | Runtime state; excluded from version control                             |
| `tests/`             | Offline tests for modules and core behavior                              |
| `.github/workflows/` | CI definition                                                            |

## ✅ Development & Quality

```bash
npm run dev
npm run check
npm run format:check
npm test
```

Use `npm run format` to apply the shared code style. Source and test files contain no code comments; setup and operational explanations live in the documentation.

Tests run without a Discord connection. They cover verification answers, timeouts, replay attempts, role permissions, panel persistence, translations, boost-event handling, configuration, and interaction routing. A configured Discord server is still needed to check live permissions and final message rendering.

## 🤝 Contributing

Focused fixes, tests, and improvements are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md), keep changes scoped, and run the local checks before opening a pull request.

## 📄 License

This project is licensed under the **ISC** license. See [LICENSE](LICENSE). Bundled assets and fonts retain their notices in [NOTICE.md](NOTICE.md) and `assets/fonts/LICENSE-DejaVu.txt`.

---

<div align="center">

**S-Service Bot — Community tools, one consistent experience.**

</div>
