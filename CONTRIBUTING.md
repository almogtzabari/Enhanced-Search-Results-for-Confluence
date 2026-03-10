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

## Quick Smoke Checklist

Run after loading both `dist/chrome` and `dist/firefox` builds:

1. Open options page in Chrome and Firefox.
2. Save domain settings and verify permission prompt behavior.
3. Open Confluence page and confirm floating launcher appears.
4. Open views page, run a search, switch tree/table, and load more results.
5. Open AI modal from views and from Confluence content page.
6. Generate summary and ask follow-up question in both browsers.
7. Toggle dark mode and confirm expected behavior in views/content modal.
