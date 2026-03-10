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
