# Contributing

Thanks for contributing to Enhanced Search Results for Confluence.

## Basic Flow

1. Fork this repository.
2. Create a feature branch:

   ```bash
   git checkout -b feature/your-feature-name
   ```

3. Commit your changes:

   ```bash
   git commit -am 'Add a new feature'
   ```

4. Push your branch and open a Pull Request.

## Automated Checks

Run from repository root before opening a PR:

```bash
npm run test:ui
npm run test:ui:coverage
npm run lint
```

For full local setup, build, packaging, extension-loading, and live smoke-test instructions, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Quick Smoke Checklist

For changes that affect search results, saved searches, filters, the launcher, permissions, AI summaries, AI follow-up chat, dark mode, or either AI modal runtime, run the live Chromium smoke when you have an approved Confluence test page and AI endpoint:

```bash
npm run smoke:confluence
```

Run the full Chromium smoke before releases or after broader UI/AI/modal changes:

```bash
npm run smoke:confluence:full
```

If this is the first run on a machine, or the Confluence login or extension permissions expired, run:

```bash
npm run smoke:confluence:setup
```

The automated smoke covers Chromium. Run this manual checklist after loading both `dist/chrome` and `dist/firefox` builds, especially for Firefox-specific release confidence:

1. Open options page in Chrome and Firefox.
2. Save domain settings and verify permission prompt behavior.
3. Open Confluence page and confirm floating launcher appears.
4. Open views page, run a search, switch tree/table, and load more results.
5. Open AI modal from views and from Confluence content page.
6. Generate summary and ask follow-up question in both browsers.
7. Toggle dark mode and confirm expected behavior in the views page.
8. In the Confluence content modal, confirm **Match Confluence theme in page modal** follows the host page by default, then disable it and verify the modal falls back to the extension theme.
