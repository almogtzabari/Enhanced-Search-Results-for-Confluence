# Development

The UI is built with **Preact + Vite** from `ui/`.

## Prerequisites

- Node.js 18+ (recommended)
- npm

## Install dependencies

```bash
npm --prefix ui install
```

## Testing and linting

Run the automated checks from repository root:

```bash
npm run test:ui
npm run test:ui:coverage
npm run lint
```

Notes:

- Coverage HTML report is generated under `ui/coverage/` (ignored by git).
- `npm run lint` uses ESLint 8.57.0 via `npx`.

## Build extension assets

```bash
npm run build:ui
```

Build output folders:

- `.build/views` (enhanced search page bundle)
- `.build/options` (options page bundle)
- `.build/content` (content bootstrap bundle)

## Build unpacked distributables (`dist/`)

From repository root:

```bash
npm run build:dist
```

`build:dist` rebuilds UI assets first, then assembles browser-specific `dist/` folders.

This generates:

- `dist/chrome`
- `dist/firefox`

You can also build a single target:

```bash
npm run build:dist:chrome
npm run build:dist:firefox
```

Verify generated dist artifacts:

```bash
npm run verify:dist
```

Build and verify in one command:

```bash
npm run build:dist:checked
```

## Live Confluence smoke tests

The repo includes live Chromium smoke tests for the extension UI. They load `dist/chrome` with Playwright, use a persistent local browser profile, open a real authenticated Confluence page, and call the configured OpenAI-compatible Responses API endpoint.

Use these checks only with a Confluence account, page, search query, and AI endpoint that are approved for this kind of local test. The smoke can send Confluence page/search content to the configured endpoint.

Create `.codex/confluence-smoke.env` in the repo root. This file is ignored by git.

Required:

```bash
CONFLUENCE_PAGE_URL=https://your-domain.atlassian.net/wiki/spaces/SPACE/pages/123456/Page
CONFLUENCE_SEARCH_QUERY=some query that returns at least one result
OPENAI_API_KEY=sk-...
OPENAI_API_BASE_URL=https://your-openai-proxy.example.com/v1
```

Useful optional settings:

```bash
CONFLUENCE_BASE_URL=https://your-domain.atlassian.net/wiki
OPENAI_MODEL=gpt-5.5
OPENAI_REASONING_EFFORT=low
CONFLUENCE_SMOKE_HEADLESS=0
CONFLUENCE_SMOKE_PROFILE_DIR=.codex/playwright-profiles/chromium-live-ai
CONFLUENCE_SMOKE_AI_TIMEOUT_MS=240000
CONFLUENCE_SMOKE_SPACE_FILTER_NAME="space name to target in full smoke"
CONFLUENCE_SMOKE_CONTRIBUTOR_FILTER_NAME="contributor display name to target in full smoke"
```

If the Playwright Chromium binary is missing:

```bash
npm --prefix ui exec playwright install chromium
```

First-time setup opens a headed browser so you can log in and approve extension host permissions:

```bash
npm run smoke:confluence:setup
```

Run the critical live path:

```bash
npm run smoke:confluence
```

Run the comprehensive Chromium UI regression smoke:

```bash
npm run smoke:confluence:full
```

Both smoke commands build and verify `dist/chrome` first. Use `--skip-build` only when the current `dist/chrome` is already up to date:

```bash
npm run smoke:confluence -- --skip-build
npm run smoke:confluence:full -- --skip-build
```

Failure artifacts are written under `.codex/smoke-results/`, including screenshots, a Playwright trace, and `failure.json`. The persistent Chromium profile is stored under `.codex/playwright-profiles/` by default.

Firefox behavior still needs a manual extension smoke because the Firefox build is MV2 and loaded through `about:debugging`. See `.codex/skills/confluence-ui-smoke/references/firefox-manual-smoke.md`.

## Package store upload archives

Create store upload archives (builds `dist/` first):

```bash
npm run zip:dist
```

Single-target packaging:

```bash
npm run zip:dist:chrome
npm run zip:dist:firefox
```

Generated files are written to `dist/packages/`:

- `enhanced-search-results-for-confluence-chrome-v<version>.zip`
- `enhanced-search-results-for-confluence-firefox-v<version>.xpi`
- `enhanced-search-results-for-confluence-source-v<version>.zip` (for Firefox reviewer source upload)

Tip: if `dist/` is already built, you can skip rebuilding:

```bash
node scripts/zip-dist.mjs all --skip-build
```

Optional for Firefox packaging:

- `FIREFOX_GECKO_ID` to override the default add-on ID (`enhancedconfluence@gmail.com`)
- `FIREFOX_STRICT_MIN_VERSION` to override minimum Firefox version (`102.0`)

Generate Chrome Web Store screenshot copies (without changing originals):

```bash
npm run build:store-images:chrome
```

Output directory:

- `dist/store-assets/chrome/screenshots/1280x800`
- `dist/store-assets/chrome/screenshots/640x400`

## UI development server

```bash
npm --prefix ui run dev
```

Use this for UI iteration. For real extension testing, run `npm run build:dist`.

## Load unpacked extension locally

After running `npm run build:dist`:

1. **Chrome**
   - Open `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked**
   - Select `dist/chrome`

2. **Firefox**
   - Open `about:debugging#/runtime/this-firefox`
   - Click **Load Temporary Add-on**
   - Select `dist/firefox/manifest.json`

## Project structure

- `ui/` - Preact + Vite UI source (views page, options page, content modal app)
- `background/` - background runtime script source
- `extension/content/` - content bootstrap + content modal stylesheet source
- `shared/` - shared runtime modules used by background/content/UI runtimes
- `assets/` - icons/images/sounds
- `scripts/` - build/verification scripts for browser dist targets
- `.build/` - intermediate generated bundles from `ui/`
- `dist/chrome`, `dist/firefox` - packaged unpacked builds for each browser
