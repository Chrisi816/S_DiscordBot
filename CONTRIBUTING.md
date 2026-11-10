# Contributing

Use a focused branch for each change and describe the problem it solves. Include screenshots when changing message layouts and explain any configuration changes.

Before opening a pull request:

```bash
npm ci
npm run check
npm run format:check
npm test
```

Keep feature logic in `src/modules/`, shared infrastructure in `src/core/`, and operational explanations in `docs/`. Preserve the existing comment-free code style. Add tests when behavior, permissions, persistence, or routing changes.

Use synthetic IDs and mocked Discord calls in tests. Keep tokens, local configuration, runtime data, logs, and user transcripts out of commits and pull requests.
