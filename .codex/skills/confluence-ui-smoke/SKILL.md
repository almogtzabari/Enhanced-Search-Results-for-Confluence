---
name: confluence-ui-smoke
description: Run the repo-local Playwright smoke tests for Enhanced Search Results for Confluence against a real authenticated Confluence page and a real OpenAI-compatible Responses API endpoint. Use when Codex needs to verify the browser extension UI did not regress across launcher injection, enhanced search, tree/table results, infinite scroll, sorting, resizing, filters, saved searches, dark mode, AI modal controls, live AI summaries, follow-up Q&A, and the content-page iframe AI modal.
---

# Confluence UI Smoke

## Overview

Use this skill to run live Chromium smoke tests for the Confluence browser extension. The tests use a persistent local Playwright profile so the user can log in to Confluence once, grant extension permissions once, and reuse that state across future runs.

## Workflow

1. Confirm the repo dependencies are installed: `npm --prefix ui install`.
2. Create `.codex/confluence-smoke.env` from the required variables below.
3. Run first-time setup in a headed browser:

   ```bash
   npm run smoke:confluence:setup
   ```

   Use the opened browser to approve optional host permissions and complete Confluence login when prompted.

4. Run routine critical smoke checks:

   ```bash
   npm run smoke:confluence
   ```

5. Run the comprehensive UI regression smoke before releases or after UI/AI/modal changes:

   ```bash
   npm run smoke:confluence:full
   ```

Use `--skip-build` only when `dist/chrome` is already current:

```bash
npm run smoke:confluence -- --skip-build
npm run smoke:confluence:full -- --skip-build
```

## Environment File

Create `.codex/confluence-smoke.env` in the repo root. Do not commit this file.

Required:

```bash
CONFLUENCE_PAGE_URL=https://your-domain.atlassian.net/wiki/spaces/SPACE/pages/123456/Page
CONFLUENCE_SEARCH_QUERY=some query that returns at least one result
OPENAI_API_KEY=sk-...
OPENAI_API_BASE_URL=https://your-openai-proxy.example.com/v1
```

Optional:

```bash
CONFLUENCE_BASE_URL=https://your-domain.atlassian.net/wiki
OPENAI_MODEL=gpt-5.5
OPENAI_REASONING_EFFORT=low
CONFLUENCE_SMOKE_HEADLESS=0
CONFLUENCE_SMOKE_PROFILE_DIR=.codex/playwright-profiles/chromium-live-ai
CONFLUENCE_SMOKE_AI_TIMEOUT_MS=240000
CONFLUENCE_SMOKE_SPACE_FILTER_NAME="space name to target in full smoke"
CONFLUENCE_SMOKE_CONTRIBUTOR_FILTER_NAME="contributor display name to target in full smoke"
CONFLUENCE_SMOKE_DATE_FILTER=1y
CONFLUENCE_SMOKE_TYPE_FILTER=page
```

## Modes And Flags

- `npm run smoke:confluence`: critical live path. It verifies launcher injection, enhanced search, tree/table switching, live views-modal AI summary + Q&A, and live content-page iframe AI summary + Q&A.
- `npm run smoke:confluence:full`: runs the critical path, then adds deeper UI regression scenarios.
- `--quick`: explicit alias for the critical path when calling the script directly.
- `--full`: enables comprehensive checks when calling the script directly.
- `--no-ai-cache-clear`: debug only. By default the runner clears local AI summaries/conversations before each live AI context so it proves the configured OpenAI-compatible endpoint still works.
- `--keep-open`: leaves Chromium open after the run for inspection.
- `CONFLUENCE_SMOKE_SPACE_FILTER_NAME` and `CONFLUENCE_SMOKE_CONTRIBUTOR_FILTER_NAME` have no code defaults. If either is omitted, that target-specific filter check is skipped.

## What The Smoke Verifies

Critical path:

- Builds and verifies `dist/chrome` unless `--skip-build` is used.
- Loads the unpacked Chromium extension from `dist/chrome`.
- Writes only the isolated Playwright profile's extension storage: Confluence domain settings, OpenAI API key, custom API base URL, AI feature toggles, and optional model settings.
- Verifies floating launcher injection on the configured Confluence page.
- Opens the enhanced search views page from the launcher.
- Runs a real Confluence search and checks tree/table views.
- Generates a live AI summary from the views-page modal and asks a follow-up question.
- Generates a live AI summary from the Confluence content-page iframe modal and asks a follow-up question.
- Verifies the content-modal host bridge sees an allowed `/rest/api/` request.
- Verifies the content-modal close message removes the iframe host.

Full mode additionally verifies:

- Options page reflects env-derived domain, endpoint, API key presence, AI-enabled state, and model; dark mode toggled in Options propagates to views.
- Tree view has rows, node links, AI buttons, and collapse/expand works when the search result tree contains an expandable parent.
- Table view has Type, Title/Name, Space, Contributor, Created, Modified, and AI columns; row count survives view switching; title/name and date sorting work when enough comparable values exist; AI buttons remain after sorting.
- Infinite scrolling in both tree and table views loads another result batch when more results are available.
- Resize interactions change dimensions by behavior thresholds: views AI modal width/height, summary/chat pane split, question textarea height, and results-table column width/reset.
- AI modal controls work: Summary/Chat visibility toggles, summary/chat font-size buttons, and Clear chat when follow-up entries exist.
- Dark mode applies to views and to the content-page iframe modal when `syncThemeToConfluencePage` is enabled, then turns off cleanly.
- Filters work for a known visible title substring; generic space/contributor suggestions; configured target space/contributor names; date filter; and type filter.
- Saved searches can be saved, loaded, filtered in the Load modal, run, renamed, deleted, and cleaned up using deterministic smoke names.

Full mode uses behavior assertions and skips only data-shape-dependent optional checks, such as no expandable tree parent or not enough parseable dates.

## Failure Handling

When the smoke fails, inspect `.codex/smoke-results/`. The runner stores screenshots, a Playwright trace zip, and `failure.json` with the current scenario and page URLs for the failed run.

Common failures:

- Missing env file or required variables: create `.codex/confluence-smoke.env`.
- Missing Chromium browser binary: run `npm --prefix ui exec playwright install chromium`.
- Missing host or endpoint permission: run `npm run smoke:confluence:setup` in a headed terminal and approve Chrome prompts.
- Confluence login expired: run setup again and log in inside the opened browser.
- AI timeout: increase `CONFLUENCE_SMOKE_AI_TIMEOUT_MS` or verify the proxy accepts the Responses API shape.

## Resources

- Run the smoke script directly: `node .codex/skills/confluence-ui-smoke/scripts/run-confluence-smoke.mjs`.
- Read `references/firefox-manual-smoke.md` when Firefox behavior must be checked manually.
