#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../..');
const uiRequire = createRequire(path.join(repoRoot, 'ui', 'package.json'));

let chromium;
try {
  ({ chromium } = uiRequire('@playwright/test'));
} catch (err) {
  throw new Error(`Playwright is not installed. Run "npm --prefix ui install" first. ${err.message}`);
}

const DEFAULT_PROFILE_DIR = '.codex/playwright-profiles/chromium-live-ai';
const DEFAULT_ENV_PATH = '.codex/confluence-smoke.env';
const DEFAULT_AI_TIMEOUT_MS = 180000;
const RESULTS_ROOT = '.codex/smoke-results';
const SUMMARY_STORE = 'summaries';
const CONVERSATION_STORE = 'conversations';
const SAVED_SEARCH_STORE = 'saved_searches';
const SMOKE_SAVED_SEARCH_PREFIX = '__codex_smoke_confluence_ui__';
const RESIZE_MIN_DELTA_PX = 20;

function parseArgs(argv) {
  const flags = new Set();
  const values = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.includes('=')) {
      const [key, ...rest] = arg.split('=');
      values.set(key, rest.join('='));
      continue;
    }
    if (arg === '--env' && argv[i + 1]) {
      values.set('--env', argv[i + 1]);
      i += 1;
      continue;
    }
    flags.add(arg);
  }
  return { flags, values };
}

function parseEnvContent(content) {
  const env = {};
  String(content || '').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const normalized = trimmed.replace(/^export\s+/, '');
    const eq = normalized.indexOf('=');
    if (eq === -1) return;
    const key = normalized.slice(0, eq).trim();
    let value = normalized.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) env[key] = value;
  });
  return env;
}

async function loadSmokeEnv(envPath) {
  let fileEnv = {};
  try {
    fileEnv = parseEnvContent(await readFile(envPath, 'utf8'));
  } catch (err) {
    throw new Error(`Missing smoke env file at ${envPath}. Create it with CONFLUENCE_PAGE_URL, CONFLUENCE_SEARCH_QUERY, OPENAI_API_KEY, and OPENAI_API_BASE_URL.`);
  }
  return { ...fileEnv, ...process.env };
}

function requireEnv(env, key) {
  const value = String(env[key] || '').trim();
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function normalizeResponsesUrl(apiUrl) {
  const fallback = 'https://api.openai.com/v1';
  let sanitizedBase = String(apiUrl || fallback).trim().replace(/\/+$/, '');
  if (!sanitizedBase) sanitizedBase = fallback;
  return /\/responses$/i.test(sanitizedBase) ? sanitizedBase : `${sanitizedBase}/responses`;
}

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function inferConfluenceBaseUrl(pageUrl) {
  const parsed = new URL(pageUrl);
  if (parsed.pathname === '/wiki' || parsed.pathname.startsWith('/wiki/')) {
    return `${parsed.origin}/wiki`;
  }
  return parsed.origin;
}

function parseReasoningEffort(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return '';
  if (['low', 'medium', 'high'].includes(value)) return value;
  throw new Error('OPENAI_REASONING_EFFORT must be one of: low, medium, high');
}

function buildConfig(rawEnv, args) {
  if (args.flags.has('--full') && args.flags.has('--quick')) {
    throw new Error('Use either --full or --quick, not both.');
  }

  const confluencePageUrl = requireEnv(rawEnv, 'CONFLUENCE_PAGE_URL');
  const confluenceSearchQuery = requireEnv(rawEnv, 'CONFLUENCE_SEARCH_QUERY');
  const openaiApiKey = requireEnv(rawEnv, 'OPENAI_API_KEY');
  const openaiApiBaseUrl = trimTrailingSlash(requireEnv(rawEnv, 'OPENAI_API_BASE_URL'));
  const parsedPageUrl = new URL(confluencePageUrl);
  const confluenceBaseUrl = trimTrailingSlash(rawEnv.CONFLUENCE_BASE_URL || inferConfluenceBaseUrl(confluencePageUrl));
  const profileDir = path.resolve(repoRoot, rawEnv.CONFLUENCE_SMOKE_PROFILE_DIR || DEFAULT_PROFILE_DIR);
  const aiTimeoutMs = Number.parseInt(rawEnv.CONFLUENCE_SMOKE_AI_TIMEOUT_MS || '', 10);

  return {
    setupMode: args.flags.has('--setup'),
    fullMode: args.flags.has('--full'),
    quickMode: args.flags.has('--quick'),
    skipBuild: args.flags.has('--skip-build'),
    keepOpen: args.flags.has('--keep-open'),
    clearAiCache: !args.flags.has('--no-ai-cache-clear'),
    headless: args.flags.has('--setup') ? false : rawEnv.CONFLUENCE_SMOKE_HEADLESS === '1',
    confluencePageUrl,
    confluenceSearchQuery,
    confluenceBaseUrl,
    confluenceHostname: parsedPageUrl.hostname.toLowerCase(),
    openaiApiKey,
    openaiApiBaseUrl,
    openaiOrigin: new URL(normalizeResponsesUrl(openaiApiBaseUrl)).origin,
    openaiModel: String(rawEnv.OPENAI_MODEL || 'gpt-5.6-terra').trim(),
    reasoningEffort: parseReasoningEffort(rawEnv.OPENAI_REASONING_EFFORT),
    targetSpaceFilterName: String(rawEnv.CONFLUENCE_SMOKE_SPACE_FILTER_NAME || '').trim(),
    targetContributorFilterName: String(rawEnv.CONFLUENCE_SMOKE_CONTRIBUTOR_FILTER_NAME || '').trim(),
    smokeDateFilter: String(rawEnv.CONFLUENCE_SMOKE_DATE_FILTER || '1y').trim(),
    smokeTypeFilter: String(rawEnv.CONFLUENCE_SMOKE_TYPE_FILTER || 'page').trim(),
    profileDir,
    distChromeDir: path.join(repoRoot, 'dist', 'chrome'),
    resultsRoot: path.join(repoRoot, RESULTS_ROOT),
    aiTimeoutMs: Number.isFinite(aiTimeoutMs) && aiTimeoutMs > 0 ? aiTimeoutMs : DEFAULT_AI_TIMEOUT_MS,
  };
}

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}`));
    });
  });
}

async function ensureFileExists(filePath, label) {
  try {
    const s = await stat(filePath);
    if (!s.isFile()) throw new Error('not a file');
  } catch {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

async function waitForEnter(message) {
  if (!process.stdin.isTTY) {
    throw new Error(`${message}\nThis setup step needs an interactive terminal.`);
  }
  const rl = createInterface({ input, output });
  try {
    await rl.question(`${message}\nPress Enter to continue after it is done.`);
  } finally {
    rl.close();
  }
}

function logStep(message) {
  console.log(`\n[smoke] ${message}`);
}

function logSkip(message) {
  console.log(`[smoke:skip] ${message}`);
}

function assertSmoke(condition, message) {
  if (!condition) throw new Error(message);
}

function extensionUrl(extensionId, relativePath) {
  return `chrome-extension://${extensionId}/${relativePath.replace(/^\/+/, '')}`;
}

async function getExtensionId(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  }
  const url = new URL(worker.url());
  if (url.protocol !== 'chrome-extension:') {
    throw new Error(`Unexpected extension service worker URL: ${worker.url()}`);
  }
  return url.hostname;
}

async function openExtensionUtilityPage(context, extensionId) {
  const optionsUrl = extensionUrl(extensionId, 'options/options.html');
  const existing = context.pages().find((candidate) => candidate.url().startsWith(optionsUrl));
  const page = existing || await context.newPage();
  if (!page.url().startsWith(optionsUrl)) {
    await page.goto(optionsUrl, { waitUntil: 'domcontentloaded' }).catch((err) => {
      const message = err?.message || '';
      if (!message.includes('interrupted by another navigation') || !page.url().startsWith(optionsUrl)) {
        throw err;
      }
    });
  }
  await page.locator('.options-root').waitFor({ timeout: 15000 });
  return page;
}

async function setExtensionStorage(page, config) {
  const syncPayload = {
    domainSettings: [{ domain: config.confluenceHostname }],
    customApiEndpoint: config.openaiApiBaseUrl,
    enableAiFeatures: true,
    enableSummaries: true,
    enableFloatingSummarize: true,
    floatingPrimaryAction: 'summarize',
    selectedAiModel: config.openaiModel,
    reasoningEffort: config.reasoningEffort,
    useHighReasoningEffort: false,
    resultsPerRequest: 75,
    darkMode: false,
    syncThemeToConfluencePage: false,
  };
  const localPayload = {
    openaiApiKey: config.openaiApiKey,
    defaultEndpointWarningShown: true,
  };

  await page.evaluate(({ syncPayload: syncData, localPayload: localData }) => new Promise((resolve, reject) => {
    chrome.storage.sync.set(syncData, () => {
      const syncError = chrome.runtime?.lastError?.message || '';
      if (syncError) {
        reject(new Error(syncError));
        return;
      }
      chrome.storage.local.set(localData, () => {
        const localError = chrome.runtime?.lastError?.message || '';
        if (localError) reject(new Error(localError));
        else resolve();
      });
    });
  }), { syncPayload, localPayload });
}

async function setSyncStorage(page, payload) {
  await page.evaluate((data) => new Promise((resolve, reject) => {
    chrome.storage.sync.set(data, () => {
      const error = chrome.runtime?.lastError?.message || '';
      if (error) reject(new Error(error));
      else resolve();
    });
  }), payload);
}

async function getSyncStorage(page, keys) {
  return page.evaluate((storageKeys) => new Promise((resolve, reject) => {
    chrome.storage.sync.get(storageKeys, (data) => {
      const error = chrome.runtime?.lastError?.message || '';
      if (error) reject(new Error(error));
      else resolve(data || {});
    });
  }), keys);
}

async function getLocalStorage(page, keys) {
  return page.evaluate((storageKeys) => new Promise((resolve, reject) => {
    chrome.storage.local.get(storageKeys, (data) => {
      const error = chrome.runtime?.lastError?.message || '';
      if (error) reject(new Error(error));
      else resolve(data || {});
    });
  }), keys);
}

async function getMissingOrigins(page, origins) {
  return page.evaluate((originPatterns) => new Promise((resolve, reject) => {
    chrome.permissions.contains({ origins: originPatterns }, (hasPermission) => {
      const error = chrome.runtime?.lastError?.message || '';
      if (error) {
        reject(new Error(error));
        return;
      }
      if (hasPermission) {
        resolve([]);
        return;
      }
      Promise.all(originPatterns.map((origin) => new Promise((innerResolve) => {
        chrome.permissions.contains({ origins: [origin] }, (singleGranted) => {
          innerResolve(singleGranted ? null : origin);
        });
      }))).then((missing) => resolve(missing.filter(Boolean)));
    });
  }), origins);
}

async function requestPermissionsViaOptions(page, config) {
  await page.goto(extensionUrl(new URL(page.url()).hostname, 'options/options.html'), { waitUntil: 'domcontentloaded' });
  await page.locator('.options-root').waitFor({ timeout: 15000 });
  await page.locator('.domain-row input').first().fill(config.confluenceHostname);
  const aiToggle = page.locator('#enable-ai-features');
  if (!(await aiToggle.isChecked())) {
    await aiToggle.setChecked(true, { force: true }).catch(async () => {
      await page.locator('label[for="enable-ai-features"]').click();
    });
  }
  await page.locator('#api-key').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#api-key').fill(config.openaiApiKey);
  await page.locator('#custom-endpoint').fill(config.openaiApiBaseUrl);
  await page.getByRole('button', { name: 'Save Settings' }).click();
}

async function ensurePermissions(page, config) {
  const origins = [
    `*://${config.confluenceHostname}/*`,
    `${config.openaiOrigin}/*`,
  ];
  let missing = await getMissingOrigins(page, origins);
  if (missing.length === 0) return;

  if (!config.setupMode) {
    throw new Error(`Missing extension permissions for ${missing.join(', ')}. Run "npm run smoke:confluence:setup" in a headed browser and approve the prompts.`);
  }
  if (config.headless) {
    throw new Error('Cannot request extension permissions in headless setup mode.');
  }

  logStep(`Requesting missing permissions: ${missing.join(', ')}`);
  await requestPermissionsViaOptions(page, config);
  await waitForEnter('Approve the Chrome extension permission prompt if it is visible.');
  missing = await getMissingOrigins(page, origins);
  if (missing.length > 0) {
    throw new Error(`Permissions are still missing: ${missing.join(', ')}`);
  }
}

async function dbAction(page, store, mode, op, payload = null) {
  return page.evaluate(({ store: storeName, mode: txMode, op: operation, payload: data }) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      dbAction: true,
      store: storeName,
      mode: txMode,
      op: operation,
      payload: data,
    }, (response) => {
      const error = chrome.runtime?.lastError?.message || '';
      if (error) {
        reject(new Error(error));
        return;
      }
      if (!response?.success) {
        reject(new Error(response?.error || 'Unknown DB action error'));
        return;
      }
      resolve(response.result);
    });
  }), {
    store,
    mode,
    op,
    payload,
  });
}

async function clearAiCache(page) {
  await dbAction(page, SUMMARY_STORE, 'readwrite', 'clear');
  await dbAction(page, CONVERSATION_STORE, 'readwrite', 'clear');
}

async function clearAiCacheIfEnabled(page, config, label) {
  if (!config.clearAiCache) {
    logSkip(`AI cache clear skipped before ${label} because --no-ai-cache-clear was passed.`);
    return;
  }
  logStep(`Clearing AI cache before ${label}`);
  await clearAiCache(page);
}

async function cleanupSmokeSavedSearches(page) {
  const savedSearches = await dbAction(page, SAVED_SEARCH_STORE, 'readonly', 'getAll');
  const smokeEntries = Array.isArray(savedSearches)
    ? savedSearches.filter((entry) => String(entry?.name || '').startsWith(SMOKE_SAVED_SEARCH_PREFIX))
    : [];
  await Promise.all(smokeEntries.map((entry) => dbAction(page, SAVED_SEARCH_STORE, 'readwrite', 'delete', entry.id)));
}

async function waitForValue(label, getter, predicate, {
  timeoutMs = 30000,
  intervalMs = 500,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  let lastError;
  while (Date.now() < deadline) {
    try {
      lastValue = await getter();
      if (predicate(lastValue)) return lastValue;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  const suffix = lastError ? ` Last error: ${lastError.message}` : ` Last value: ${JSON.stringify(lastValue)}`;
  throw new Error(`Timed out waiting for ${label}.${suffix}`);
}

async function visibleTextList(locator) {
  return locator.evaluateAll((nodes) => nodes
    .filter((node) => {
      const style = window.getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
    })
    .map((node) => String(node.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean));
}

async function visibleLocatorCount(locator) {
  return locator.evaluateAll((nodes) => nodes.filter((node) => {
    const style = window.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
  }).length);
}

function normalizeCellText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function compareText(a, b) {
  return normalizeCellText(a).localeCompare(normalizeCellText(b), undefined, {
    numeric: true,
    sensitivity: 'base',
    ignorePunctuation: true,
  });
}

function listsDiffer(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return true;
  return a.some((value, index) => value !== b[index]);
}

function isSorted(values, direction = 'asc', parser = (value) => normalizeCellText(value)) {
  const parsed = values.map(parser).filter((value) => value !== null && value !== undefined && value !== '');
  if (parsed.length < 2) return false;
  for (let i = 1; i < parsed.length; i += 1) {
    const previous = parsed[i - 1];
    const current = parsed[i];
    const cmp = typeof previous === 'number' && typeof current === 'number'
      ? previous - current
      : compareText(previous, current);
    if (direction === 'asc' && cmp > 0) return false;
    if (direction === 'desc' && cmp < 0) return false;
  }
  return true;
}

function parseDateCell(value) {
  const parsed = Date.parse(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

async function ensureTreeView(page) {
  await page.getByRole('button', { name: /^Tree$/ }).click();
  await page.locator('.tree-list.root .tree-item').first().waitFor({
    state: 'visible',
    timeout: 15000,
  });
}

async function ensureTableView(page) {
  await page.getByRole('button', { name: /^Table$/ }).click();
  await page.locator('.results-table tbody tr').first().waitFor({
    state: 'visible',
    timeout: 15000,
  });
}

async function resetTableHorizontalScroll(page) {
  const scroller = page.locator('.results-scroll.table-mode').first();
  if (await scroller.count() === 0) return;
  await scroller.evaluate((node) => {
    node.scrollLeft = 0;
  }).catch(() => {});
  await page.waitForTimeout(150);
}

async function getTableHeaders(page) {
  return page.locator('.results-table thead th').evaluateAll((nodes) => nodes
    .map((node) => String(node.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean));
}

async function getTableColumnIndex(page, label) {
  const headers = await getTableHeaders(page);
  const index = headers.findIndex((header) => normalizeCellText(header).startsWith(label));
  return index;
}

async function getTitleColumnLabel(page) {
  const headers = await getTableHeaders(page);
  if (headers.some((header) => normalizeCellText(header).startsWith('Title'))) return 'Title';
  if (headers.some((header) => normalizeCellText(header).startsWith('Name'))) return 'Name';
  throw new Error('Missing table title/name column.');
}

async function getTableColumnTexts(page, labelOrIndex) {
  const colIndex = typeof labelOrIndex === 'number'
    ? labelOrIndex
    : await getTableColumnIndex(page, labelOrIndex);
  if (colIndex < 0) return [];
  return page.evaluate((index) => Array.from(document.querySelectorAll('.results-table tbody tr'))
    .map((row) => String(row.cells?.[index]?.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean), colIndex);
}

async function getTableRowCount(page) {
  return visibleLocatorCount(page.locator('.results-table tbody tr'));
}

async function getLoadedStats(page) {
  const text = await page.locator('.stats-row').filter({ hasText: 'Showing' }).locator('.stats-value').first().innerText().catch(() => '');
  const match = text.match(/\((\d+)\/(\d+|…)/);
  const loaded = match ? Number.parseInt(match[1], 10) : null;
  const total = match && match[2] !== '…' ? Number.parseInt(match[2], 10) : null;
  const showingMatch = text.match(/^(\d+)/);
  const showing = showingMatch ? Number.parseInt(showingMatch[1], 10) : null;
  return {
    text,
    showing: Number.isFinite(showing) ? showing : null,
    loaded: Number.isFinite(loaded) ? loaded : null,
    total: Number.isFinite(total) ? total : null,
  };
}

async function tableSortButton(page, label) {
  const button = page.locator('.results-table .table-sort-btn').filter({ hasText: label }).first();
  await button.waitFor({ state: 'visible', timeout: 10000 });
  return button;
}

async function resetTableSort(page, label) {
  const button = await tableSortButton(page, label);
  for (let i = 0; i < 3; i += 1) {
    const title = await button.getAttribute('title');
    if (String(title || '').startsWith(`Sort by ${label}`)) return;
    await button.click();
    await page.waitForTimeout(150);
  }
}

async function dragLocator(page, locator, deltaX, deltaY) {
  const box = await locator.boundingBox();
  assertSmoke(box, `Cannot drag missing element: ${locator}`);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function dragLocatorByDispatchedMouseDown(page, locator, deltaX, deltaY) {
  const box = await locator.boundingBox();
  assertSmoke(box, `Cannot dispatch-drag missing element: ${locator}`);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await locator.dispatchEvent('mousedown', {
    button: 0,
    buttons: 1,
    clientX: startX,
    clientY: startY,
    bubbles: true,
    cancelable: true,
  });
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function dragUntilBoxDelta(page, targetLocator, handleLocator, axis, firstDelta, fallbackDelta, label) {
  const before = await targetLocator.boundingBox();
  assertSmoke(before, `Cannot measure ${label} before drag.`);
  await dragLocator(page, handleLocator, axis === 'x' ? firstDelta : 0, axis === 'y' ? firstDelta : 0);
  let after = await targetLocator.boundingBox();
  assertSmoke(after, `Cannot measure ${label} after drag.`);
  let delta = axis === 'x' ? after.width - before.width : after.height - before.height;
  if (Math.abs(delta) < RESIZE_MIN_DELTA_PX) {
    await dragLocator(page, handleLocator, axis === 'x' ? fallbackDelta : 0, axis === 'y' ? fallbackDelta : 0);
    after = await targetLocator.boundingBox();
    assertSmoke(after, `Cannot measure ${label} after fallback drag.`);
    delta = axis === 'x' ? after.width - before.width : after.height - before.height;
  }
  assertSmoke(Math.abs(delta) >= RESIZE_MIN_DELTA_PX, `${label} did not resize by at least ${RESIZE_MIN_DELTA_PX}px.`);
  return { before, after, delta };
}

async function getTableColWidth(page, colIndex) {
  return page.locator('.results-table col').nth(colIndex).evaluate((col) => {
    const styleWidth = Number.parseFloat(col.style.width || '');
    if (Number.isFinite(styleWidth)) return styleWidth;
    const computedWidth = Number.parseFloat(window.getComputedStyle(col).width || '');
    return Number.isFinite(computedWidth) ? computedWidth : 0;
  });
}

async function selectCustomSelectValue(page, triggerSelector, value, label) {
  const trigger = page.locator(triggerSelector).first();
  await trigger.waitFor({ state: 'visible', timeout: 10000 });
  const current = await trigger.getAttribute('data-value');
  if (current === value) return;
  await trigger.click();
  const option = page.locator('.custom-select-option').filter({
    has: page.locator(`[data-value="${value}"]`),
  });
  if (await option.count() > 0) {
    await option.first().click();
    return;
  }
  const directOption = page.locator(`.custom-select-option[data-value="${value}"]`).first();
  await directOption.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {
    throw new Error(`Could not find ${label} option with value "${value}".`);
  });
  await directOption.click();
}

async function waitForSearchResultsToSettle(page, label) {
  await waitForValue(label, async () => {
    const rowCount = await getTableRowCount(page);
    const emptyVisible = await page.locator('.panel.results .empty').first().isVisible().catch(() => false);
    const searchingVisible = await page.locator('.searching-state').first().isVisible().catch(() => false);
    return { rowCount, emptyVisible, searchingVisible };
  }, (state) => !state.searchingVisible && (state.rowCount > 0 || state.emptyVisible), {
    timeoutMs: 45000,
    intervalMs: 500,
  });
}

async function applyComboFilterByName(page, {
  inputSelector,
  optionSelector,
  name,
  label,
}) {
  if (!name) {
    logSkip(`${label} target filter skipped because no target name is configured.`);
    return false;
  }
  const input = page.locator(inputSelector).first();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.fill(name);
  await input.focus();
  const option = page.locator(optionSelector).filter({ hasText: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first();
  const found = await option.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
  if (!found) {
    logSkip(`${label} target filter "${name}" skipped because no matching suggestion appeared.`);
    return false;
  }
  await option.click();
  await waitForSearchResultsToSettle(page, `${label} target filter results`);
  return true;
}

async function dismissNoticeIfPresent(page) {
  const notice = page.locator('.notice-dialog');
  if (await notice.count() === 0) return;
  if (!(await notice.first().isVisible().catch(() => false))) return;
  await page.locator('.notice-dialog-actions .btn').first().click();
  await notice.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
}

async function clearSidebarFilters(page) {
  const textFilter = page.locator('input[placeholder="Filter by text"]').first();
  if (await textFilter.count() > 0) await textFilter.fill('');

  const clearButtons = page.locator('.combo-clear-selected');
  while ((await clearButtons.count()) > 0) {
    const button = clearButtons.first();
    if (!(await button.isVisible().catch(() => false))) break;
    await button.click();
    await page.waitForTimeout(150);
  }
}

async function ensureConfluenceLauncher(page, config) {
  await page.goto(config.confluencePageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  const launcher = page.locator('#enhanced-fab-shell');
  try {
    await launcher.waitFor({ state: 'visible', timeout: 20000 });
    return;
  } catch (err) {
    if (!config.setupMode) {
      throw new Error(`Floating launcher did not appear. Run setup to confirm login and permissions. ${err.message}`);
    }
  }

  await waitForEnter('Complete Confluence login in the opened Chromium window, then return to the configured page if needed.');
  await page.goto(config.confluencePageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await launcher.waitFor({ state: 'visible', timeout: 30000 });
}

async function openViewsFromLauncher(confluencePage, context) {
  const launcher = confluencePage.locator('#enhanced-fab-shell');
  await expandLauncher(confluencePage, 'launcher expanded state');
  const searchButton = confluencePage.locator('button[aria-label="Open Enhanced Search"]').first();
  await searchButton.waitFor({ state: 'visible', timeout: 10000 });
  const [viewsPage] = await Promise.all([
    context.waitForEvent('page', { timeout: 15000 }),
    searchButton.click(),
  ]);
  await viewsPage.waitForLoadState('domcontentloaded');
  await viewsPage.locator('.v2-root').waitFor({ timeout: 15000 });
  return viewsPage;
}

async function expandLauncher(page, label) {
  const launcher = page.locator('#enhanced-fab-shell');
  const mainButton = launcher.locator('button.enhanced-fab-main');
  await mainButton.waitFor({ state: 'visible', timeout: 10000 });
  await mainButton.hover().catch(() => {});
  await mainButton.focus().catch(() => {});
  await waitForValue(label, async () => launcher.evaluate((node) => node.classList.contains('expanded')), Boolean, {
    timeoutMs: 5000,
    intervalMs: 100,
  }).catch(async (err) => {
    await mainButton.dispatchEvent('mouseenter').catch(() => {});
    await mainButton.dispatchEvent('focus').catch(() => {});
    await waitForValue(label, async () => launcher.evaluate((node) => node.classList.contains('expanded')), Boolean, {
      timeoutMs: 5000,
      intervalMs: 100,
    }).catch(() => {
      throw err;
    });
  });
}

async function runSearchSmoke(viewsPage, config) {
  const extensionId = new URL(viewsPage.url()).hostname;
  const params = new URLSearchParams({
    baseUrl: config.confluenceBaseUrl,
    focusSearch: '1',
  });
  await viewsPage.goto(extensionUrl(extensionId, `views/index.html?${params.toString()}`), { waitUntil: 'domcontentloaded' });
  await viewsPage.locator('.v2-root').waitFor({ timeout: 15000 });

  const searchInput = viewsPage.locator('.search-input');
  await searchInput.waitFor({ state: 'visible', timeout: 10000 });
  await searchInput.fill(config.confluenceSearchQuery);
  await viewsPage.locator('.search-btn').click();

  await viewsPage.locator('.tree-list.root .tree-item').first().waitFor({
    state: 'visible',
    timeout: 60000,
  });

  await viewsPage.getByRole('button', { name: /^Table$/ }).click();
  await viewsPage.locator('.results-table tbody tr').first().waitFor({
    state: 'visible',
    timeout: 15000,
  });

  await viewsPage.getByRole('button', { name: /^Tree$/ }).click();
  await viewsPage.locator('.tree-list.root .tree-item').first().waitFor({
    state: 'visible',
    timeout: 15000,
  });
}

async function waitForAiSummary(root, label, timeoutMs) {
  await root.locator('.ai-modal').first().waitFor({ state: 'visible', timeout: 30000 });
  await root.locator('.ai-modal-content').first().waitFor({ state: 'visible', timeout: timeoutMs });

  const summary = root.locator('.ai-summary').first();
  await waitForValue(`${label} summary text`, async () => (await summary.innerText()).trim(), (text) => text.length >= 20, {
    timeoutMs,
  });
}

async function waitForAiSummaryAndAsk(root, label, timeoutMs) {
  await waitForAiSummary(root, label, timeoutMs);

  const textarea = root.locator('.ai-question-row textarea').first();
  await textarea.fill('In one short sentence, what is this page about?');
  await root.locator('.ai-action-btn.ask').first().click();

  const assistantAnswers = root.locator('.qa-entry.assistant:not(.typing-bubble)');
  await waitForValue(`${label} assistant answer`, async () => {
    const count = await assistantAnswers.count();
    if (count === 0) return '';
    return (await assistantAnswers.nth(count - 1).innerText()).trim();
  }, (text) => text.length >= 10, {
    timeoutMs,
  });
}

async function runViewsAiSmoke(viewsPage, config) {
  const aiButton = viewsPage.locator('.mini-ai-btn').filter({ hasText: /Summarize|Open/ }).first();
  await aiButton.waitFor({ state: 'visible', timeout: 15000 });
  await aiButton.click();
  await waitForAiSummaryAndAsk(viewsPage, 'views AI modal', config.aiTimeoutMs);
  await viewsPage.locator('.ai-modal-head button[title="Close"]').click();
  await viewsPage.locator('.ai-modal').waitFor({ state: 'detached', timeout: 10000 });
}

async function installBridgeProbe(page) {
  await page.evaluate(() => {
    if (window.__enhancedSmokeBridgeListener) {
      window.removeEventListener('message', window.__enhancedSmokeBridgeListener, true);
    }
    window.__enhancedSmokeBridgeFetchCount = 0;
    window.__enhancedSmokeBridgeListener = (event) => {
      const payload = event.data || {};
      const url = String(payload.url || '');
      if (payload.type === 'enhanced-ai-modal-fetch' && /\/rest\/api\//.test(url)) {
        window.__enhancedSmokeBridgeFetchCount += 1;
      }
    };
    window.addEventListener('message', window.__enhancedSmokeBridgeListener, true);
  });
}

async function openContentModalFromLauncher(confluencePage) {
  await expandLauncher(confluencePage, 'launcher expanded state for content summary');

  const splitSummarizeButton = confluencePage.locator('#enhanced-fab-shell .enhanced-fab-split button[aria-label="Open Summary and Q&A"], #enhanced-fab-shell .enhanced-fab-split button[aria-label="Open Existing Summary and Q&A"]').first();
  const mainSummarizeButton = confluencePage.locator('#enhanced-fab-shell button.enhanced-fab-main[aria-label="Open Summary and Q&A"], #enhanced-fab-shell button.enhanced-fab-main[aria-label="Open Existing Summary and Q&A"]').first();
  const summarizeButton = await splitSummarizeButton.count() > 0
    ? splitSummarizeButton
    : mainSummarizeButton;
  await summarizeButton.waitFor({ state: 'visible', timeout: 20000 });
  await summarizeButton.click();

  await confluencePage.locator('#enhanced-content-ai-modal-frame').waitFor({ state: 'attached', timeout: 30000 });
  return confluencePage.frameLocator('#enhanced-content-ai-modal-frame');
}

async function runContentModalAiSmoke(confluencePage, config) {
  await installBridgeProbe(confluencePage);

  const modalFrame = await openContentModalFromLauncher(confluencePage);
  await waitForAiSummaryAndAsk(modalFrame, 'content iframe AI modal', config.aiTimeoutMs);

  await waitForValue('content modal bridge REST request', async () => confluencePage.evaluate(() => window.__enhancedSmokeBridgeFetchCount || 0), (count) => count > 0, {
    timeoutMs: 30000,
  });

  await modalFrame.locator('.ai-modal-head button[title="Close"]').click();
  await confluencePage.locator('#enhanced-content-ai-modal-host').waitFor({ state: 'detached', timeout: 15000 });
}

async function runCoreSmoke(runtime) {
  const {
    context,
    config,
    extensionPage,
  } = runtime;

  logStep('Opening Confluence page and verifying launcher injection');
  const confluencePage = await context.newPage();
  await ensureConfluenceLauncher(confluencePage, config);

  logStep('Opening enhanced search from the launcher');
  const viewsPage = await openViewsFromLauncher(confluencePage, context);

  logStep('Running real Confluence search and basic tree/table checks');
  await runSearchSmoke(viewsPage, config);

  await clearAiCacheIfEnabled(extensionPage, config, 'views-page modal smoke');
  logStep('Generating live AI summary and Q&A in views modal');
  await runViewsAiSmoke(viewsPage, config);

  await clearAiCacheIfEnabled(extensionPage, config, 'content iframe modal smoke');
  await confluencePage.bringToFront();
  await ensureConfluenceLauncher(confluencePage, config);

  logStep('Generating live AI summary and Q&A in content iframe modal');
  await runContentModalAiSmoke(confluencePage, config);

  runtime.confluencePage = confluencePage;
  runtime.viewsPage = viewsPage;
}

async function runTreeSmoke({ viewsPage }) {
  await viewsPage.bringToFront();
  await ensureTreeView(viewsPage);

  const counts = await viewsPage.locator('.tree-list.root').evaluate((root) => ({
    rows: root.querySelectorAll('.tree-row').length,
    links: root.querySelectorAll('.node-link[href]').length,
    aiButtons: root.querySelectorAll('.mini-ai-btn').length,
  }));
  assertSmoke(counts.rows > 0, 'Tree view has no rows.');
  assertSmoke(counts.links > 0, 'Tree view has no node links.');
  assertSmoke(counts.aiButtons > 0, 'Tree view has no AI buttons.');

  const candidateIndex = await viewsPage.locator('.tree-list.root .tree-item').evaluateAll((items) => items.findIndex((item) => {
    const row = item.querySelector(':scope > .tree-row');
    const toggle = row?.querySelector('button.toggle');
    const childList = item.querySelector(':scope > .tree-list');
    return !!toggle && !!childList && childList.querySelectorAll('.tree-row').length > 0;
  }));

  if (candidateIndex < 0) {
    logSkip('Tree collapse/expand skipped because this search returned no expandable parent nodes.');
    return;
  }

  const parentItem = viewsPage.locator('.tree-list.root .tree-item').nth(candidateIndex);
  const initialDescendants = await parentItem.evaluate((item) => item.querySelector(':scope > .tree-list')?.querySelectorAll('.tree-row').length || 0);
  assertSmoke(initialDescendants > 0, 'Expandable tree parent has no visible descendants before collapse.');

  await parentItem.locator(':scope > .tree-row button.toggle').click();
  await waitForValue('tree descendants to collapse', async () => parentItem.evaluate((item) => item.querySelector(':scope > .tree-list')?.querySelectorAll('.tree-row').length || 0), (count) => count === 0, {
    timeoutMs: 5000,
    intervalMs: 100,
  });

  await parentItem.locator(':scope > .tree-row button.toggle').click();
  await waitForValue('tree descendants to expand', async () => parentItem.evaluate((item) => item.querySelector(':scope > .tree-list')?.querySelectorAll('.tree-row').length || 0), (count) => count >= initialDescendants, {
    timeoutMs: 5000,
    intervalMs: 100,
  });
}

async function runTableSmoke({ viewsPage }) {
  await viewsPage.bringToFront();
  await ensureTableView(viewsPage);

  const expectedHeaders = ['Type', 'Space', 'Contributor', 'Created', 'Modified', 'AI'];
  const headers = await getTableHeaders(viewsPage);
  const titleColumnLabel = await getTitleColumnLabel(viewsPage);
  expectedHeaders.forEach((label) => {
    assertSmoke(headers.some((header) => header.startsWith(label)), `Missing table column: ${label}`);
  });

  const initialRowCount = await getTableRowCount(viewsPage);
  assertSmoke(initialRowCount > 0, 'Table view has no visible rows.');
  await ensureTreeView(viewsPage);
  await ensureTableView(viewsPage);
  const rowCountAfterSwitch = await getTableRowCount(viewsPage);
  assertSmoke(rowCountAfterSwitch === initialRowCount, `Table row count changed after view switch: ${initialRowCount} -> ${rowCountAfterSwitch}`);

  const titles = await getTableColumnTexts(viewsPage, titleColumnLabel);
  const uniqueTitles = new Set(titles.map((title) => title.toLowerCase())).size;
  if (titles.length < 2 || uniqueTitles < 2) {
    logSkip(`${titleColumnLabel} sorting skipped because fewer than two distinct visible values are available.`);
  } else {
    await resetTableSort(viewsPage, titleColumnLabel);
    const beforeTitleSort = await getTableColumnTexts(viewsPage, titleColumnLabel);
    const titleButton = await tableSortButton(viewsPage, titleColumnLabel);
    await titleButton.click();
    const ascTitles = await waitForValue(`${titleColumnLabel} ascending sort`, () => getTableColumnTexts(viewsPage, titleColumnLabel), (values) => listsDiffer(values, beforeTitleSort) || isSorted(values, 'asc'), {
      timeoutMs: 10000,
      intervalMs: 250,
    });
    await titleButton.click();
    await waitForValue(`${titleColumnLabel} descending sort`, () => getTableColumnTexts(viewsPage, titleColumnLabel), (values) => listsDiffer(values, ascTitles) || isSorted(values, 'desc'), {
      timeoutMs: 10000,
      intervalMs: 250,
    });
  }

  for (const label of ['Created', 'Modified']) {
    const values = await getTableColumnTexts(viewsPage, label);
    const parseableValues = values.map(parseDateCell).filter((value) => value !== null);
    const uniqueDates = new Set(parseableValues).size;
    if (parseableValues.length < 2 || uniqueDates < 2) {
      logSkip(`${label} date sorting skipped because fewer than two parseable distinct dates are visible.`);
      continue;
    }
    const button = await tableSortButton(viewsPage, label);
    await button.click();
    await waitForValue(`${label} ascending sort`, () => getTableColumnTexts(viewsPage, label), (nextValues) => isSorted(nextValues, 'asc', parseDateCell), {
      timeoutMs: 10000,
      intervalMs: 250,
    });
  }

  const aiButtons = await visibleLocatorCount(viewsPage.locator('.results-table tbody .mini-ai-btn'));
  assertSmoke(aiButtons > 0, 'AI buttons disappeared from the table after sorting.');
}

async function scrollResultsToLoadMore(page, label) {
  const before = await getLoadedStats(page);
  if (!before.loaded || (before.total !== null && before.loaded >= before.total)) {
    logSkip(`${label} infinite-scroll skipped because all known results are already loaded. Stats: ${before.text}`);
    return;
  }

  const scroller = page.locator('.results-scroll').first();
  await scroller.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await waitForValue(`${label} loaded result count to increase`, () => getLoadedStats(page), (stats) => (
    (stats.loaded !== null && stats.loaded > before.loaded)
    || (stats.total !== null && stats.loaded !== null && stats.loaded >= stats.total)
  ), {
    timeoutMs: 60000,
    intervalMs: 750,
  });
}

async function runInfiniteScrollSmoke({ viewsPage }) {
  await viewsPage.bringToFront();

  await ensureTreeView(viewsPage);
  await scrollResultsToLoadMore(viewsPage, 'tree view');
  const treeRowsAfterScroll = await visibleLocatorCount(viewsPage.locator('.tree-row'));
  assertSmoke(treeRowsAfterScroll > 0, 'Tree view lost all rows after infinite-scroll.');

  await ensureTableView(viewsPage);
  await resetTableHorizontalScroll(viewsPage);
  await scrollResultsToLoadMore(viewsPage, 'table view');
  const tableRowsAfterScroll = await getTableRowCount(viewsPage);
  assertSmoke(tableRowsAfterScroll > 0, 'Table view lost all rows after infinite-scroll.');
}

async function runResizeSmoke({ viewsPage, config }) {
  await viewsPage.bringToFront();
  await viewsPage.setViewportSize({ width: 1440, height: 1000 }).catch(() => {});
  await ensureTableView(viewsPage);

  const titleColumnLabel = await getTitleColumnLabel(viewsPage);
  const titleColumnIndex = await getTableColumnIndex(viewsPage, titleColumnLabel);
  assertSmoke(titleColumnIndex >= 0, `Cannot find ${titleColumnLabel} column for table resize smoke.`);
  const titleHeader = viewsPage.locator('.results-table thead th').nth(titleColumnIndex);
  const tableHandle = titleHeader.locator('.th-resizer-v2');
  const tableBaseline = await getTableColWidth(viewsPage, titleColumnIndex);
  assertSmoke(tableBaseline > 0, `Cannot measure ${titleColumnLabel} table column before resize.`);
  await dragLocator(viewsPage, tableHandle, 90, 0);
  let tableResized = await getTableColWidth(viewsPage, titleColumnIndex);
  if (Math.abs(tableResized - tableBaseline) < RESIZE_MIN_DELTA_PX) {
    await dragLocator(viewsPage, tableHandle, -140, 0);
    tableResized = await getTableColWidth(viewsPage, titleColumnIndex);
  }
  if (Math.abs(tableResized - tableBaseline) < RESIZE_MIN_DELTA_PX) {
    await dragLocatorByDispatchedMouseDown(viewsPage, tableHandle, 140, 0);
    tableResized = await getTableColWidth(viewsPage, titleColumnIndex);
  }
  assertSmoke(Math.abs(tableResized - tableBaseline) >= RESIZE_MIN_DELTA_PX, `${titleColumnLabel} table column did not resize by at least ${RESIZE_MIN_DELTA_PX}px.`);
  await tableHandle.dblclick();
  await viewsPage.waitForTimeout(300);
  const tableReset = await getTableColWidth(viewsPage, titleColumnIndex);
  assertSmoke(tableReset > 0, `Cannot measure ${titleColumnLabel} table column after reset.`);
  assertSmoke(
    Math.abs(tableReset - tableBaseline) < Math.abs(tableResized - tableBaseline),
    `${titleColumnLabel} table column double-click reset did not move width back toward the baseline.`,
  );
  await resetTableHorizontalScroll(viewsPage);

  const aiButton = viewsPage.locator('.mini-ai-btn').filter({ hasText: /Summarize|Open/ }).first();
  await aiButton.waitFor({ state: 'visible', timeout: 15000 });
  await aiButton.click();
  await waitForAiSummary(viewsPage, 'views AI modal for resize smoke', config.aiTimeoutMs);

  const modal = viewsPage.locator('.ai-modal').first();
  await dragUntilBoxDelta(
    viewsPage,
    modal,
    viewsPage.locator('.ai-modal-resizer-right').first(),
    'x',
    90,
    -140,
    'views AI modal width',
  );
  await dragUntilBoxDelta(
    viewsPage,
    modal,
    viewsPage.locator('.ai-modal-height-resizer:not(.ai-modal-height-resizer-top)').first(),
    'y',
    70,
    -120,
    'views AI modal height',
  );

  const summaryPanel = viewsPage.locator('.ai-summary-panel').first();
  const paneHandle = viewsPage.locator('.ai-pane-resizer').first();
  const paneBefore = await summaryPanel.boundingBox();
  assertSmoke(paneBefore, 'Cannot measure summary pane before resize.');
  await dragLocator(viewsPage, paneHandle, 100, 0);
  let paneAfter = await summaryPanel.boundingBox();
  assertSmoke(paneAfter, 'Cannot measure summary pane after resize.');
  if (Math.abs(paneAfter.width - paneBefore.width) < RESIZE_MIN_DELTA_PX) {
    await dragLocator(viewsPage, paneHandle, -160, 0);
    paneAfter = await summaryPanel.boundingBox();
    assertSmoke(paneAfter, 'Cannot measure summary pane after fallback resize.');
  }
  assertSmoke(Math.abs(paneAfter.width - paneBefore.width) >= RESIZE_MIN_DELTA_PX, 'AI summary/chat pane resize did not change pane width enough.');

  const textarea = viewsPage.locator('.ai-question-row textarea').first();
  const questionHandle = viewsPage.locator('.ai-question-resize-handle').first();
  const textareaBefore = await textarea.boundingBox();
  assertSmoke(textareaBefore, 'Cannot measure AI question textarea before resize.');
  await dragLocator(viewsPage, questionHandle, 0, -70);
  let textareaAfter = await textarea.boundingBox();
  assertSmoke(textareaAfter, 'Cannot measure AI question textarea after resize.');
  if (Math.abs(textareaAfter.height - textareaBefore.height) < RESIZE_MIN_DELTA_PX) {
    await dragLocator(viewsPage, questionHandle, 0, 90);
    textareaAfter = await textarea.boundingBox();
    assertSmoke(textareaAfter, 'Cannot measure AI question textarea after fallback resize.');
  }
  assertSmoke(Math.abs(textareaAfter.height - textareaBefore.height) >= RESIZE_MIN_DELTA_PX, 'AI question textarea resize did not change height enough.');

  await viewsPage.locator('.ai-modal-head button[title="Close"]').click();
  await viewsPage.locator('.ai-modal').waitFor({ state: 'detached', timeout: 10000 });
}

async function getCssPixelNumber(locator, property) {
  const value = await locator.evaluate((node, cssProperty) => window.getComputedStyle(node).getPropertyValue(cssProperty), property);
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function getInlineCssPixelVariable(locator, variableName) {
  const value = await locator.evaluate((node, name) => node.style.getPropertyValue(name) || window.getComputedStyle(node).getPropertyValue(name), variableName);
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function runAiModalControlsSmoke({ viewsPage, config }) {
  await viewsPage.bringToFront();
  await ensureTableView(viewsPage);

  const aiButton = viewsPage.locator('.mini-ai-btn').filter({ hasText: /Summarize|Open/ }).first();
  await aiButton.waitFor({ state: 'visible', timeout: 15000 });
  await aiButton.click();
  await waitForAiSummary(viewsPage, 'views AI modal controls smoke', config.aiTimeoutMs);

  const layout = viewsPage.locator('.ai-layout').first();
  const summaryToggle = viewsPage.locator('.ai-visibility-btn').filter({ hasText: /^Summary$/ }).first();
  const chatToggle = viewsPage.locator('.ai-visibility-btn').filter({ hasText: /^Chat$/ }).first();

  await summaryToggle.click();
  await waitForValue('summary panel collapse', () => layout.evaluate((node) => node.classList.contains('summary-collapsed')), Boolean, {
    timeoutMs: 10000,
    intervalMs: 100,
  });
  await summaryToggle.click();
  await waitForValue('summary panel restore', () => layout.evaluate((node) => node.classList.contains('summary-collapsed')), (collapsed) => !collapsed, {
    timeoutMs: 10000,
    intervalMs: 100,
  });

  await chatToggle.click();
  await waitForValue('chat panel collapse', () => layout.evaluate((node) => node.classList.contains('chat-collapsed')), Boolean, {
    timeoutMs: 10000,
    intervalMs: 100,
  });
  await chatToggle.click();
  await waitForValue('chat panel restore', () => layout.evaluate((node) => node.classList.contains('chat-collapsed')), (collapsed) => !collapsed, {
    timeoutMs: 10000,
    intervalMs: 100,
  });

  const summary = viewsPage.locator('.ai-summary').first();
  const summaryPlus = viewsPage.locator('.ai-summary-panel .pane-font-btn').filter({ hasText: /^A\+$/ }).first();
  const summaryMinus = viewsPage.locator('.ai-summary-panel .pane-font-btn').filter({ hasText: /^A-$/ }).first();
  const summaryFontBefore = await getCssPixelNumber(summary, 'font-size');
  await summaryPlus.click();
  await waitForValue('summary font increase', () => getCssPixelNumber(summary, 'font-size'), (value) => value > summaryFontBefore, {
    timeoutMs: 5000,
    intervalMs: 100,
  });
  await summaryMinus.click();
  await waitForValue('summary font decrease', () => getCssPixelNumber(summary, 'font-size'), (value) => value <= summaryFontBefore + 0.1, {
    timeoutMs: 5000,
    intervalMs: 100,
  });

  const thread = viewsPage.locator('.ai-thread').first();
  const chatPlus = viewsPage.locator('.ai-chat-panel .pane-font-btn').filter({ hasText: /^A\+$/ }).first();
  const chatMinus = viewsPage.locator('.ai-chat-panel .pane-font-btn').filter({ hasText: /^A-$/ }).first();
  const chatFontBefore = await getInlineCssPixelVariable(thread, '--chat-font-size');
  await chatPlus.click();
  await waitForValue('chat font increase', () => getInlineCssPixelVariable(thread, '--chat-font-size'), (value) => value > chatFontBefore, {
    timeoutMs: 5000,
    intervalMs: 100,
  });
  await chatMinus.click();
  await waitForValue('chat font decrease', () => getInlineCssPixelVariable(thread, '--chat-font-size'), (value) => value <= chatFontBefore + 0.1, {
    timeoutMs: 5000,
    intervalMs: 100,
  });

  await viewsPage.locator('.ai-question-row textarea').first().fill('Answer in three words: what is the page topic?');
  await viewsPage.locator('.ai-action-btn.ask').first().click();
  await waitForValue('AI modal controls assistant answer', async () => {
    const assistantAnswers = viewsPage.locator('.qa-entry.assistant:not(.typing-bubble)');
    const count = await assistantAnswers.count();
    if (count === 0) return '';
    return (await assistantAnswers.nth(count - 1).innerText()).trim();
  }, (text) => text.length >= 3, {
    timeoutMs: config.aiTimeoutMs,
    intervalMs: 500,
  });

  await viewsPage.locator('.pane-clear-btn').click();
  await viewsPage.locator('.confirm-dialog').waitFor({ state: 'visible', timeout: 10000 });
  await viewsPage.locator('.confirm-dialog-actions .btn').filter({ hasText: /^Clear$/ }).click();
  await waitForValue('chat clear removes follow-up entries', () => viewsPage.locator('.qa-entry').count(), (count) => count === 0, {
    timeoutMs: 10000,
    intervalMs: 250,
  });

  await viewsPage.locator('.ai-modal-head button[title="Close"]').click();
  await viewsPage.locator('.ai-modal').waitFor({ state: 'detached', timeout: 10000 });
}

async function runDarkModeSmoke({
  extensionPage,
  viewsPage,
  confluencePage,
  config,
}) {
  await viewsPage.bringToFront();
  await setSyncStorage(extensionPage, { darkMode: true, syncThemeToConfluencePage: true });
  await viewsPage.locator('body.dark-mode').waitFor({ state: 'attached', timeout: 10000 });

  await confluencePage.bringToFront();
  await ensureConfluenceLauncher(confluencePage, config);
  const modalFrame = await openContentModalFromLauncher(confluencePage);
  await modalFrame.locator('body.dark-mode').waitFor({ state: 'attached', timeout: 15000 });
  await modalFrame.locator('.ai-modal-head button[title="Close"]').click();
  await confluencePage.locator('#enhanced-content-ai-modal-host').waitFor({ state: 'detached', timeout: 15000 });

  await setSyncStorage(extensionPage, { darkMode: false, syncThemeToConfluencePage: false });
  await waitForValue('views dark mode class removal', () => viewsPage.locator('body').evaluate((body) => body.classList.contains('dark-mode')), (enabled) => enabled === false, {
    timeoutMs: 10000,
    intervalMs: 100,
  });
}

async function runFiltersSmoke({ viewsPage, config }) {
  await viewsPage.bringToFront();
  await ensureTableView(viewsPage);
  await resetTableHorizontalScroll(viewsPage);
  await clearSidebarFilters(viewsPage);
  await resetTableHorizontalScroll(viewsPage);

  const originalCount = await getTableRowCount(viewsPage);
  assertSmoke(originalCount > 0, 'Cannot run filter smoke without table rows.');
  const titleColumnLabel = await getTitleColumnLabel(viewsPage);
  const titles = await getTableColumnTexts(viewsPage, titleColumnLabel);
  const sourceTitle = titles.find((title) => title.length >= 3) || titles[0] || '';
  const token = sourceTitle.split(/\s+/).find((part) => part.replace(/[^\p{L}\p{N}]/gu, '').length >= 3)
    || sourceTitle.slice(0, Math.min(6, sourceTitle.length));

  if (!token) {
    logSkip('Text filter skipped because visible titles do not expose a useful substring.');
  } else {
    const filterInput = viewsPage.locator('input[placeholder="Filter by text"]').first();
    await filterInput.fill(token);
    await waitForValue('text-filtered table row count', () => getTableRowCount(viewsPage), (count) => count > 0 && count <= originalCount, {
      timeoutMs: 10000,
      intervalMs: 250,
    });
    const filteredTitles = await getTableColumnTexts(viewsPage, titleColumnLabel);
    if (filteredTitles.length > 0) {
      assertSmoke(
        filteredTitles.every((title) => title.toLowerCase().includes(token.toLowerCase())),
        `Text filter returned a ${titleColumnLabel} value that does not include "${token}".`,
      );
    } else {
      logSkip(`Text filter ${titleColumnLabel} text-match assertion skipped because column text was unavailable after filtering.`);
    }
    await filterInput.fill('');
    await waitForValue('text filter clear', () => getTableRowCount(viewsPage), (count) => count === originalCount, {
      timeoutMs: 10000,
      intervalMs: 250,
    });
  }

  const spaceInput = viewsPage.locator('input[placeholder="Filter spaces (type to search)"]').first();
  await spaceInput.focus();
  const spaceOption = viewsPage.locator('.space-options .combo-option').first();
  if (await spaceOption.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false)) {
    await spaceOption.click();
    await waitForValue('space-filtered table rows', () => getTableRowCount(viewsPage), (count) => count > 0 && count <= originalCount, {
      timeoutMs: 10000,
      intervalMs: 250,
    });
    await clearSidebarFilters(viewsPage);
  } else {
    logSkip('Space filter skipped because no visible space suggestions are available.');
  }

  const contributorInput = viewsPage.locator('input[placeholder="Filter contributors (type to search)"]').first();
  await contributorInput.focus();
  const contributorOption = viewsPage.locator('.contributor-options .combo-option').first();
  if (await contributorOption.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false)) {
    await contributorOption.click();
    await waitForValue('contributor-filtered table rows', () => getTableRowCount(viewsPage), (count) => count > 0 && count <= originalCount, {
      timeoutMs: 10000,
      intervalMs: 250,
    });
    await clearSidebarFilters(viewsPage);
  } else {
    logSkip('Contributor filter skipped because no visible contributor suggestions are available.');
  }

  const targetSpaceApplied = await applyComboFilterByName(viewsPage, {
    inputSelector: 'input[placeholder="Filter spaces (type to search)"]',
    optionSelector: '.space-options .combo-option',
    name: config.targetSpaceFilterName,
    label: 'target space',
  });
  if (targetSpaceApplied) {
    const spaceCount = await getTableRowCount(viewsPage);
    if (spaceCount > 0) {
      const spaces = await getTableColumnTexts(viewsPage, 'Space');
      assertSmoke(
        spaces.length === 0 || spaces.every((space) => space.toLowerCase().includes(config.targetSpaceFilterName.toLowerCase())),
        `Target space filter returned a row outside "${config.targetSpaceFilterName}".`,
      );
    } else {
      logSkip(`Target space "${config.targetSpaceFilterName}" selected but returned no rows for the current search query.`);
    }
    await clearSidebarFilters(viewsPage);
    await waitForSearchResultsToSettle(viewsPage, 'target space filter clear results');
  }

  const targetContributorApplied = await applyComboFilterByName(viewsPage, {
    inputSelector: 'input[placeholder="Filter contributors (type to search)"]',
    optionSelector: '.contributor-options .combo-option',
    name: config.targetContributorFilterName,
    label: 'target contributor',
  });
  if (targetContributorApplied) {
    const contributorCount = await getTableRowCount(viewsPage);
    if (contributorCount > 0) {
      const contributors = await getTableColumnTexts(viewsPage, 'Contributor');
      assertSmoke(
        contributors.length === 0 || contributors.every((contributor) => contributor.toLowerCase().includes(config.targetContributorFilterName.toLowerCase())),
        `Target contributor filter returned a row outside "${config.targetContributorFilterName}".`,
      );
    } else {
      logSkip(`Target contributor "${config.targetContributorFilterName}" selected but returned no rows for the current search query.`);
    }
    await clearSidebarFilters(viewsPage);
    await waitForSearchResultsToSettle(viewsPage, 'target contributor filter clear results');
  }

  if (config.smokeDateFilter && config.smokeDateFilter !== 'any') {
    await selectCustomSelectValue(viewsPage, '#filter-date-sidebar', config.smokeDateFilter, 'date filter');
    await waitForSearchResultsToSettle(viewsPage, 'date filter results');
    const dateFilteredCount = await getTableRowCount(viewsPage);
    assertSmoke(dateFilteredCount <= originalCount, `Date filter increased visible row count from ${originalCount} to ${dateFilteredCount}.`);
    await selectCustomSelectValue(viewsPage, '#filter-date-sidebar', 'any', 'date filter reset');
    await waitForSearchResultsToSettle(viewsPage, 'date filter reset results');
  }

  if (config.smokeTypeFilter) {
    await selectCustomSelectValue(viewsPage, '#filter-type-sidebar', config.smokeTypeFilter, 'type filter');
    await waitForSearchResultsToSettle(viewsPage, 'type filter results');
    const typeFilteredCount = await getTableRowCount(viewsPage);
    assertSmoke(typeFilteredCount <= originalCount, `Type filter increased visible row count from ${originalCount} to ${typeFilteredCount}.`);
    await selectCustomSelectValue(viewsPage, '#filter-type-sidebar', '', 'type filter reset');
    await waitForSearchResultsToSettle(viewsPage, 'type filter reset results');
  }
}

async function runSavedSearchSmoke({ extensionPage, viewsPage, config }) {
  await viewsPage.bringToFront();
  await ensureTableView(viewsPage);
  await clearSidebarFilters(viewsPage);
  await cleanupSmokeSavedSearches(extensionPage);
  await dismissNoticeIfPresent(viewsPage);

  const smokeName = `${SMOKE_SAVED_SEARCH_PREFIX}current`;
  const decoySmokeName = `${SMOKE_SAVED_SEARCH_PREFIX}decoy`;
  const renamedSmokeName = `${SMOKE_SAVED_SEARCH_PREFIX}renamed`;
  const sidebarButton = (label) => viewsPage.locator('.sidebar .btn.view-btn').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).first();

  const saveSearchWithName = async (name) => {
    await sidebarButton('Save').click();
    await viewsPage.locator('.name-dialog').waitFor({ state: 'visible', timeout: 10000 });
    await viewsPage.locator('#save-name-input').fill(name);
    await viewsPage.locator('.name-dialog-actions .btn').filter({ hasText: /^Save$/ }).click();
    await dismissNoticeIfPresent(viewsPage);
  };

  await saveSearchWithName(smokeName);
  await saveSearchWithName(decoySmokeName);

  await sidebarButton('Load').click();
  await viewsPage.locator('.saved-modal').waitFor({ state: 'visible', timeout: 10000 });
  const savedSearchFilter = viewsPage.locator('.saved-modal-toolbar input[placeholder="Filter saved searches..."]').first();
  await savedSearchFilter.fill('current');
  let entry = viewsPage.locator('.saved-entry').filter({ hasText: smokeName }).first();
  await entry.waitFor({ state: 'visible', timeout: 10000 });
  await waitForValue('saved search modal filter hides non-matching smoke entry', async () => viewsPage.locator('.saved-entry').filter({ hasText: decoySmokeName }).count(), (count) => count === 0, {
    timeoutMs: 5000,
    intervalMs: 250,
  });

  await entry.locator('.saved-entry-actions .btn').filter({ hasText: /^Run$/ }).click();
  await viewsPage.locator('.saved-modal').waitFor({ state: 'detached', timeout: 10000 });
  await waitForValue('saved search query after run', () => viewsPage.locator('.search-input').inputValue(), (value) => value.trim() === config.confluenceSearchQuery.trim(), {
    timeoutMs: 10000,
    intervalMs: 250,
  });

  await sidebarButton('Load').click();
  await viewsPage.locator('.saved-modal').waitFor({ state: 'visible', timeout: 10000 });
  await viewsPage.locator('.saved-modal-toolbar input[placeholder="Filter saved searches..."]').fill('current');
  entry = viewsPage.locator('.saved-entry').filter({ hasText: smokeName }).first();
  await entry.locator('.saved-entry-actions .btn').filter({ hasText: /^Rename$/ }).click();
  await viewsPage.locator('.name-dialog').waitFor({ state: 'visible', timeout: 10000 });
  await viewsPage.locator('#save-name-input').fill(renamedSmokeName);
  await viewsPage.locator('.name-dialog-actions .btn').filter({ hasText: /^Rename$/ }).click();
  await viewsPage.locator('.saved-modal-toolbar input[placeholder="Filter saved searches..."]').fill('renamed');
  await viewsPage.locator('.saved-entry').filter({ hasText: renamedSmokeName }).first().waitFor({ state: 'visible', timeout: 10000 });

  entry = viewsPage.locator('.saved-entry').filter({ hasText: renamedSmokeName }).first();
  await entry.locator('.saved-entry-actions .btn').filter({ hasText: /^Delete$/ }).click();
  await viewsPage.locator('.confirm-dialog').waitFor({ state: 'visible', timeout: 10000 });
  await viewsPage.locator('.confirm-dialog-actions .btn').filter({ hasText: /^Delete$/ }).click();
  await waitForValue('saved search deletion', async () => viewsPage.locator('.saved-entry').filter({ hasText: renamedSmokeName }).count(), (count) => count === 0, {
    timeoutMs: 10000,
    intervalMs: 250,
  });
  await viewsPage.locator('.saved-modal-toolbar input[placeholder="Filter saved searches..."]').fill('decoy');
  const decoyEntry = viewsPage.locator('.saved-entry').filter({ hasText: decoySmokeName }).first();
  await decoyEntry.waitFor({ state: 'visible', timeout: 10000 });
  await decoyEntry.locator('.saved-entry-actions .btn').filter({ hasText: /^Delete$/ }).click();
  await viewsPage.locator('.confirm-dialog').waitFor({ state: 'visible', timeout: 10000 });
  await viewsPage.locator('.confirm-dialog-actions .btn').filter({ hasText: /^Delete$/ }).click();
  await waitForValue('decoy saved search deletion', async () => viewsPage.locator('.saved-entry').filter({ hasText: decoySmokeName }).count(), (count) => count === 0, {
    timeoutMs: 10000,
    intervalMs: 250,
  });
  await viewsPage.locator('.saved-modal-head .icon-btn').click();
  await viewsPage.locator('.saved-modal').waitFor({ state: 'detached', timeout: 10000 });
  await cleanupSmokeSavedSearches(extensionPage);
}

async function runOptionsSmoke({ extensionPage, viewsPage, config }) {
  await extensionPage.bringToFront();
  await extensionPage.locator('.options-root').waitFor({ state: 'visible', timeout: 15000 });

  const domainValue = await extensionPage.locator('.domain-row input').first().inputValue();
  assertSmoke(domainValue.trim().toLowerCase() === config.confluenceHostname, `Options domain mismatch: expected ${config.confluenceHostname}, got ${domainValue}`);
  assertSmoke(await extensionPage.locator('#enable-ai-features').isChecked(), 'Options AI feature toggle is not enabled.');

  const localData = await getLocalStorage(extensionPage, ['openaiApiKey']);
  assertSmoke(String(localData.openaiApiKey || '').length > 0, 'Options local API key storage is empty.');

  await extensionPage.locator('#custom-endpoint').waitFor({ state: 'visible', timeout: 10000 });
  const endpointValue = await extensionPage.locator('#custom-endpoint').inputValue();
  assertSmoke(endpointValue.trim().replace(/\/+$/, '') === config.openaiApiBaseUrl, `Options endpoint mismatch: expected configured endpoint, got ${endpointValue}`);

  const modelValue = await extensionPage.locator('#ai-model').getAttribute('data-value');
  assertSmoke(modelValue === config.openaiModel, `Options model mismatch: expected ${config.openaiModel}, got ${modelValue}`);

  const settings = await getSyncStorage(extensionPage, ['darkMode']);
  if (settings.darkMode) {
    await setSyncStorage(extensionPage, { darkMode: false });
    await waitForValue('options dark mode reset', () => extensionPage.locator('body').evaluate((body) => body.classList.contains('dark-mode')), (enabled) => enabled === false, {
      timeoutMs: 10000,
      intervalMs: 100,
    });
  }

  await extensionPage.locator('#theme-toggle-btn').click();
  await extensionPage.locator('body.dark-mode').waitFor({ state: 'attached', timeout: 10000 });
  await viewsPage.locator('body.dark-mode').waitFor({ state: 'attached', timeout: 10000 });

  await extensionPage.locator('#theme-toggle-btn').click();
  await waitForValue('options dark mode class removal', () => extensionPage.locator('body').evaluate((body) => body.classList.contains('dark-mode')), (enabled) => enabled === false, {
    timeoutMs: 10000,
    intervalMs: 100,
  });
  await waitForValue('views dark mode class removal after options toggle', () => viewsPage.locator('body').evaluate((body) => body.classList.contains('dark-mode')), (enabled) => enabled === false, {
    timeoutMs: 10000,
    intervalMs: 100,
  });
}

async function runScenario(runtime, name, fn) {
  runtime.currentScenario = name;
  logStep(`Scenario: ${name}`);
  await fn(runtime);
}

async function runFullSmoke(runtime) {
  await runScenario(runtime, 'options', runOptionsSmoke);
  await runScenario(runtime, 'tree view', runTreeSmoke);
  await runScenario(runtime, 'table view', runTableSmoke);
  await runScenario(runtime, 'infinite scroll', runInfiniteScrollSmoke);
  await runScenario(runtime, 'resize', runResizeSmoke);
  await runScenario(runtime, 'AI modal controls', runAiModalControlsSmoke);
  await runScenario(runtime, 'dark mode', runDarkModeSmoke);
  await runScenario(runtime, 'filters', runFiltersSmoke);
  await runScenario(runtime, 'saved searches', runSavedSearchSmoke);
}

async function saveFailureArtifacts(context, resultsDir, error, runtime) {
  await mkdir(resultsDir, { recursive: true });
  await context.tracing.stop({ path: path.join(resultsDir, 'trace.zip') }).catch(() => {});
  const pages = context.pages();
  const pageSummaries = [];
  await Promise.all(pages.map(async (page, index) => {
    try {
      pageSummaries.push({
        index: index + 1,
        url: page.url(),
        title: await page.title().catch(() => ''),
      });
      await page.screenshot({
        path: path.join(resultsDir, `failure-page-${index + 1}.png`),
        fullPage: true,
      });
    } catch {
      // Ignore screenshot failures from closed pages.
    }
  }));
  await writeFile(path.join(resultsDir, 'failure.json'), `${JSON.stringify({
    scenario: runtime?.currentScenario || 'startup',
    message: error.message || String(error),
    stack: error.stack || '',
    pages: pageSummaries,
  }, null, 2)}\n`, 'utf8').catch(() => {});
  console.error(`\n[smoke] Failed: ${error.message}`);
  console.error(`[smoke] Scenario: ${runtime?.currentScenario || 'startup'}`);
  console.error(`[smoke] Artifacts: ${resultsDir}`);
}

async function runSmoke(config) {
  if (!config.skipBuild) {
    logStep('Building and verifying dist bundles');
    await runCommand('npm', ['run', 'build:dist:checked'], repoRoot);
  }
  await ensureFileExists(path.join(config.distChromeDir, 'manifest.json'), 'Chrome dist manifest');
  await mkdir(config.profileDir, { recursive: true });
  await mkdir(config.resultsRoot, { recursive: true });

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsDir = path.join(config.resultsRoot, runId);

  logStep(`Launching Chromium with profile ${path.relative(repoRoot, config.profileDir)}`);
  const context = await chromium.launchPersistentContext(config.profileDir, {
    headless: config.headless,
    args: [
      `--disable-extensions-except=${config.distChromeDir}`,
      `--load-extension=${config.distChromeDir}`,
    ],
  });

  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  let traceStopped = false;
  const runtime = {
    context,
    config,
    currentScenario: 'startup',
    extensionPage: null,
    confluencePage: null,
    viewsPage: null,
  };

  try {
    const extensionId = await getExtensionId(context);
    logStep(`Loaded extension ${extensionId}`);

    const extensionPage = await openExtensionUtilityPage(context, extensionId);
    runtime.extensionPage = extensionPage;
    await setExtensionStorage(extensionPage, config);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await ensurePermissions(extensionPage, config);

    runtime.currentScenario = config.quickMode ? 'quick core smoke' : 'core smoke';
    await runCoreSmoke(runtime);

    if (config.fullMode) {
      await runFullSmoke(runtime);
    }

    await context.tracing.stop();
    traceStopped = true;
    console.log(`\n[smoke] Confluence ${config.fullMode ? 'full' : 'live AI'} UI smoke passed.`);
  } catch (err) {
    if (!traceStopped) {
      await saveFailureArtifacts(context, resultsDir, err, runtime);
      traceStopped = true;
    }
    throw err;
  } finally {
    if (!traceStopped) await context.tracing.stop().catch(() => {});
    if (config.keepOpen) {
      await waitForEnter('Smoke finished. The browser is still open because --keep-open was passed.');
    }
    await context.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envPath = path.resolve(repoRoot, args.values.get('--env') || DEFAULT_ENV_PATH);
  const rawEnv = await loadSmokeEnv(envPath);
  const config = buildConfig(rawEnv, args);
  await runSmoke(config);
}

main().catch((err) => {
  console.error(`\n[smoke] ${err.message || err}`);
  process.exit(1);
});
