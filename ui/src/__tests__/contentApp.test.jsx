import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const LOADER_FLAG = '__enhancedConfluenceContentAppLoaded';
const ROOT_ID = 'enhanced-content-app-root';
const MODAL_HOST_ID = 'enhanced-content-ai-modal-host';
const MODAL_IFRAME_ID = 'enhanced-content-ai-modal-frame';
const MODAL_BOOTSTRAP_ID = 'enhanced-content-ai-modal-bootstrap';
const AI_MODAL_BOUNDS_MESSAGE = 'enhanced-ai-modal-bounds';
const AI_MODAL_THEME_MESSAGE = 'enhanced-ai-modal-theme';

function createChromeMock({
  enableFloatingSummarize = true,
  enableAiFeatures = false,
  enableSummaries = true,
  floatingPrimaryAction = 'search',
  localApiKey = '',
  syncApiKey = '',
  customApiEndpoint = 'https://api.openai.com/v1',
  ensurePermission = { granted: true, error: '' },
  storedSummariesByContentId = {},
  withOpenOptionsPage = true,
} = {}) {
  const storageChangeListeners = new Set();
  const state = {
    enableFloatingSummarize,
    enableAiFeatures,
    enableSummaries,
    floatingPrimaryAction,
    localApiKey,
    syncApiKey,
    customApiEndpoint,
  };
  const runtimeSendMessage = vi.fn((message, callback) => {
    if (message?.action === 'ensureApiOriginPermission') {
      callback?.(ensurePermission);
      return;
    }
    if (message?.dbAction && message.store === 'summaries' && message.op === 'get') {
      const contentId = String(message?.payload?.[0] || '').trim();
      const summaryExists = !!storedSummariesByContentId[contentId];
      callback?.({
        success: true,
        result: summaryExists ? { summaryHtml: '<p>cached</p>' } : null,
      });
      return;
    }
    callback?.({});
  });
  const runtime = {
    getURL: vi.fn((path) => `https://extension.local/${path}`),
    sendMessage: runtimeSendMessage,
    lastError: null,
  };
  if (withOpenOptionsPage) {
    runtime.openOptionsPage = vi.fn();
  }

  const storageSyncGet = vi.fn((keys, callback) => {
    const keyList = Array.isArray(keys) ? keys : [keys];
    const response = {};
    if (keyList.includes('enableFloatingSummarize')) response.enableFloatingSummarize = state.enableFloatingSummarize;
    if (keyList.includes('enableAiFeatures')) response.enableAiFeatures = state.enableAiFeatures;
    if (keyList.includes('enableSummaries')) response.enableSummaries = state.enableSummaries;
    if (keyList.includes('floatingPrimaryAction')) response.floatingPrimaryAction = state.floatingPrimaryAction;
    if (keyList.includes('openaiApiKey')) response.openaiApiKey = state.syncApiKey;
    if (keyList.includes('customApiEndpoint')) response.customApiEndpoint = state.customApiEndpoint;
    callback(response);
  });
  const storageLocalGet = vi.fn((keys, callback) => {
    const keyList = Array.isArray(keys) ? keys : [keys];
    if (keyList.includes('openaiApiKey')) {
      callback({ openaiApiKey: state.localApiKey });
      return;
    }
    callback({});
  });

  const chrome = {
    runtime,
    storage: {
      sync: {
        get: storageSyncGet,
      },
      local: {
        get: storageLocalGet,
      },
      onChanged: {
        addListener: vi.fn((listener) => {
          storageChangeListeners.add(listener);
        }),
        removeListener: vi.fn((listener) => {
          storageChangeListeners.delete(listener);
        }),
      },
    },
  };

  return {
    chrome,
    runtimeSendMessage,
    storageSyncGet,
    storageLocalGet,
    triggerStorageChange(changes, area = 'sync') {
      Object.entries(changes || {}).forEach(([key, change]) => {
        const nextValue = change?.newValue;
        if (area === 'local' && key === 'openaiApiKey') state.localApiKey = typeof nextValue === 'string' ? nextValue : '';
        if (area === 'sync') {
          if (key === 'enableFloatingSummarize') state.enableFloatingSummarize = nextValue;
          if (key === 'enableAiFeatures') state.enableAiFeatures = nextValue;
          if (key === 'enableSummaries') state.enableSummaries = nextValue;
          if (key === 'floatingPrimaryAction') state.floatingPrimaryAction = nextValue;
          if (key === 'openaiApiKey') state.syncApiKey = typeof nextValue === 'string' ? nextValue : '';
          if (key === 'customApiEndpoint') state.customApiEndpoint = typeof nextValue === 'string' ? nextValue : state.customApiEndpoint;
        }
      });
      Array.from(storageChangeListeners).forEach((listener) => {
        listener(changes, area);
      });
    },
  };
}

async function loadContentAppModule() {
  vi.resetModules();
  return import('../contentApp.jsx');
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function flushMany(count = 5) {
  for (let i = 0; i < count; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await flush();
  }
}

async function flushTask() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await flushMany();
}

function clickByAriaLabel(label) {
  const el = document.querySelector(`[aria-label="${label}"]`);
  if (!el) {
    const available = [...document.querySelectorAll('[aria-label]')]
      .map((node) => node.getAttribute('aria-label'));
    throw new Error(`Element with aria-label "${label}" not found. Available: ${available.join(', ')}`);
  }
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('contentApp', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete window[LOADER_FLAG];
    window.__enhancedContentModalCleanup = null;
    delete window.AJS;
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-color-mode');
    window.history.replaceState({}, '', '/wiki/pages/12345?pageId=12345');
    global.fetch = vi.fn();
    delete global.chrome;
    document.title = 'My Confluence Page';
  });

  afterEach(() => {
    try {
      window.dispatchEvent(new Event('beforeunload'));
    } catch {
      // ignore
    }
    if (typeof window.__enhancedContentModalCleanup === 'function') {
      window.__enhancedContentModalCleanup();
    }
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    document.documentElement.removeAttribute('data-color-mode');
    delete window[LOADER_FLAG];
    window.__enhancedContentModalCleanup = null;
    delete window.AJS;
  });

  it('bootstraps once and keeps launcher mounted when legacy floating flag changes', async () => {
    const runtime = createChromeMock({ enableFloatingSummarize: true });
    global.chrome = runtime.chrome;

    const { bootstrapContentApp } = await loadContentAppModule();
    bootstrapContentApp();
    await flushMany();

    expect(document.getElementById(ROOT_ID)).toBeTruthy();
    expect(runtime.chrome.storage.onChanged.addListener).toHaveBeenCalledTimes(2);

    bootstrapContentApp();
    await flush();
    expect(document.querySelectorAll(`#${ROOT_ID}`)).toHaveLength(1);

    act(() => {
      runtime.triggerStorageChange({
        enableFloatingSummarize: { newValue: false },
      });
    });
    await flushMany();
    expect(document.getElementById(ROOT_ID)).toBeTruthy();

    act(() => {
      runtime.triggerStorageChange({
        enableFloatingSummarize: { newValue: true },
      });
    });
    await flushMany();
    expect(document.getElementById(ROOT_ID)).toBeTruthy();

    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });
    expect(runtime.chrome.storage.onChanged.removeListener).toHaveBeenCalledTimes(1);
  });

  it('opens search page with detected base url from content button', async () => {
    const runtime = createChromeMock({ enableFloatingSummarize: true });
    global.chrome = runtime.chrome;
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'ajs-context-path');
    meta.setAttribute('content', '/wiki');
    document.head.appendChild(meta);

    const { bootstrapContentApp } = await loadContentAppModule();
    bootstrapContentApp();
    await flushMany();

    clickByAriaLabel('Open Enhanced Search');
    expect(runtime.runtimeSendMessage).toHaveBeenCalledWith(expect.objectContaining({
      action: 'openSearchTab',
      searchText: '',
      baseUrl: `${window.location.origin}/wiki`,
      focusSearch: true,
    }));
  });

  it('opens options page using runtime API or falls back to openTab message', async () => {
    const runtimeWithOpenOptions = createChromeMock({ withOpenOptionsPage: true });
    global.chrome = runtimeWithOpenOptions.chrome;
    let mod = await loadContentAppModule();
    mod.bootstrapContentApp();
    await flushMany();

    clickByAriaLabel('Extension Settings');
    expect(runtimeWithOpenOptions.chrome.runtime.openOptionsPage).toHaveBeenCalledTimes(1);

    document.body.innerHTML = '';
    document.head.innerHTML = '';
    delete window[LOADER_FLAG];
    const runtimeWithoutOpenOptions = createChromeMock({ withOpenOptionsPage: false });
    global.chrome = runtimeWithoutOpenOptions.chrome;
    mod = await loadContentAppModule();
    mod.bootstrapContentApp();
    await flushMany();

    clickByAriaLabel('Extension Settings');
    expect(runtimeWithoutOpenOptions.runtimeSendMessage).toHaveBeenCalledWith({
      action: 'openTab',
      url: 'https://extension.local/options/options.html',
    });
  });

  it('shows missing content id dialog when summarize cannot resolve page id', async () => {
    const runtime = createChromeMock({
      enableFloatingSummarize: true,
      enableAiFeatures: true,
      localApiKey: 'local-key',
    });
    global.chrome = runtime.chrome;
    window.history.replaceState({}, '', '/wiki/unknown/location');

    const { bootstrapContentApp } = await loadContentAppModule();
    bootstrapContentApp();
    await flushTask();

    clickByAriaLabel('Open Summary and Q&A');
    await flushMany();

    const dialogTitle = document.querySelector('.dialog-content h2');
    expect(dialogTitle?.textContent).toBe('Unable to Summarize');
    expect(document.getElementById(MODAL_HOST_ID)).toBeFalsy();
  });

  it('shows cached summary state on summarize action when summary already exists', async () => {
    const runtime = createChromeMock({
      enableFloatingSummarize: true,
      enableAiFeatures: true,
      localApiKey: 'local-key',
      storedSummariesByContentId: { 12345: true },
    });
    global.chrome = runtime.chrome;

    const { bootstrapContentApp } = await loadContentAppModule();
    bootstrapContentApp();
    await flushMany();

    const summarizeButton = document.querySelector('.enhanced-fab-btn.enhanced-fab-summarize');
    expect(summarizeButton?.getAttribute('data-label')).toBe('Open summary and chat');
    expect(summarizeButton?.classList.contains('has-summary')).toBe(true);
  });

  it('opens the content modal without repeating page lookup or waiting for summary refresh', async () => {
    const runtime = createChromeMock({
      enableFloatingSummarize: true,
      enableAiFeatures: true,
      localApiKey: 'local-key',
      storedSummariesByContentId: { 12345: true },
    });
    global.chrome = runtime.chrome;
    window.history.replaceState({}, '', '/display/ENG/My+Page');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ results: [{ id: '12345' }] }),
    });

    const { bootstrapContentApp } = await loadContentAppModule();
    bootstrapContentApp();
    await flushTask();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const originalSendMessage = runtime.runtimeSendMessage.getMockImplementation();
    runtime.runtimeSendMessage.mockImplementation((message, callback) => {
      if (message?.dbAction && message.store === 'summaries' && message.op === 'get') return;
      originalSendMessage(message, callback);
    });

    clickByAriaLabel('Open Existing Summary and Q&A');
    await flushMany();

    expect(document.getElementById(MODAL_HOST_ID)).toBeTruthy();
    expect(document.getElementById(MODAL_BOOTSTRAP_ID)?.textContent).toContain(
      'Opening Summary and Q&A',
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('passes runtime fallback metadata into content-modal params when prefetched metadata is missing', async () => {
    const runtime = createChromeMock({
      enableFloatingSummarize: true,
      enableAiFeatures: true,
      localApiKey: 'local-key',
      storedSummariesByContentId: { 12345: true },
    });
    global.chrome = runtime.chrome;
    document.documentElement.setAttribute('data-color-mode', 'dark');
    window.AJS = {
      Meta: { get: vi.fn(() => '') },
      params: {
        spaceName: 'Engineering',
        spaceKey: 'ENG',
        creatorDisplayName: 'Ada Lovelace',
        creator: 'adal',
        pageType: 'page',
      },
    };

    const { bootstrapContentApp } = await loadContentAppModule();
    bootstrapContentApp();
    await flushMany();

    clickByAriaLabel('Open Existing Summary and Q&A');
    await flushMany();

    const iframe = document.getElementById('enhanced-content-ai-modal-frame');
    expect(iframe).toBeTruthy();
    const bootstrapPanel = document.getElementById(MODAL_BOOTSTRAP_ID);
    expect(bootstrapPanel?.style.backgroundColor).toBe('rgb(28, 34, 39)');
    expect(bootstrapPanel?.style.borderColor).toBe('transparent');
    expect(bootstrapPanel?.firstElementChild?.style.borderBottomColor).toBe(
      'rgba(185, 204, 222, 0.28)',
    );
    const modalUrl = new URL(String(iframe.getAttribute('src') || ''), window.location.origin);
    expect(modalUrl.searchParams.get('spaceName')).toBe('Engineering');
    expect(modalUrl.searchParams.get('spaceKey')).toBe('ENG');
    expect(modalUrl.searchParams.get('contributorName')).toBe('Ada Lovelace');
    expect(modalUrl.searchParams.get('contributorUsername')).toBe('adal');
    expect(modalUrl.searchParams.get('hostTheme')).toBe('dark');

    const postMessage = vi.spyOn(iframe.contentWindow, 'postMessage');
    document.documentElement.setAttribute('data-color-mode', 'light');
    await flushMany();
    expect(postMessage).toHaveBeenCalledWith(
      { type: AI_MODAL_THEME_MESSAGE, theme: 'light' },
      'https://extension.local',
    );
  });

  it('clips the content-modal iframe exactly to validated bounds from its own frame', async () => {
    const runtime = createChromeMock({
      enableFloatingSummarize: true,
      enableAiFeatures: true,
      localApiKey: 'local-key',
      storedSummariesByContentId: { 12345: true },
    });
    global.chrome = runtime.chrome;

    const { bootstrapContentApp } = await loadContentAppModule();
    bootstrapContentApp();
    await flushMany();

    clickByAriaLabel('Open Existing Summary and Q&A');
    await flushMany();

    const iframe = document.getElementById(MODAL_IFRAME_ID);
    expect(iframe).toBeTruthy();
    expect(document.getElementById(MODAL_BOOTSTRAP_ID)).toBeTruthy();
    expect(iframe.style.getPropertyValue('clip-path')).toBe('inset(50% round 16px)');
    expect(iframe.style.getPropertyPriority('clip-path')).toBe('important');
    expect(iframe.style.getPropertyValue('mask-image')).toBe('');

    const contentWindow = iframe.contentWindow;
    window.dispatchEvent(new MessageEvent('message', {
      source: contentWindow,
      origin: 'https://extension.local',
      data: {
        type: AI_MODAL_BOUNDS_MESSAGE,
        bounds: { x: 120, y: 80, width: 640, height: 480 },
      },
    }));

    act(() => {
      iframe.dispatchEvent(new Event('load'));
    });

    const clipPath = iframe.style.getPropertyValue('clip-path');
    expect(clipPath).toBe(
      `inset(80px ${window.innerWidth - 760}px ${window.innerHeight - 560}px 120px round 16px)`,
    );
    expect(iframe.style.getPropertyPriority('clip-path')).toBe('important');
    expect(iframe.style.opacity).toBe('1');
    expect(document.getElementById(MODAL_BOOTSTRAP_ID)).toBeFalsy();

    window.dispatchEvent(new MessageEvent('message', {
      source: contentWindow,
      origin: 'https://extension.local',
      data: {
        type: AI_MODAL_BOUNDS_MESSAGE,
        bounds: { x: '120', y: 80, width: 640, height: 480 },
      },
    }));
    expect(iframe.style.getPropertyValue('clip-path')).toBe(clipPath);
  });

  it('clips against the iframe client box when Chrome innerWidth includes a scrollbar gutter', async () => {
    const runtime = createChromeMock({
      enableFloatingSummarize: true,
      enableAiFeatures: true,
      localApiKey: 'local-key',
      storedSummariesByContentId: { 12345: true },
    });
    global.chrome = runtime.chrome;

    const { bootstrapContentApp } = await loadContentAppModule();
    bootstrapContentApp();
    await flushMany();

    clickByAriaLabel('Open Existing Summary and Q&A');
    await flushMany();

    const iframe = document.getElementById(MODAL_IFRAME_ID);
    Object.defineProperties(iframe, {
      clientWidth: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 700 },
    });
    const contentWindow = iframe.contentWindow;
    window.dispatchEvent(new MessageEvent('message', {
      source: contentWindow,
      origin: 'https://extension.local',
      data: {
        type: AI_MODAL_BOUNDS_MESSAGE,
        bounds: { x: 100, y: 50, width: 800, height: 600 },
      },
    }));

    expect(window.innerWidth).toBeGreaterThan(1000);
    expect(iframe.style.getPropertyValue('clip-path')).toBe(
      'inset(50px 100px 50px 100px round 16px)',
    );
  });

  it('ignores modal bounds messages from other windows and origins', async () => {
    const runtime = createChromeMock({
      enableFloatingSummarize: true,
      enableAiFeatures: true,
      localApiKey: 'local-key',
      storedSummariesByContentId: { 12345: true },
    });
    global.chrome = runtime.chrome;

    const { bootstrapContentApp } = await loadContentAppModule();
    bootstrapContentApp();
    await flushMany();

    clickByAriaLabel('Open Existing Summary and Q&A');
    await flushMany();

    const iframe = document.getElementById(MODAL_IFRAME_ID);
    const initialClipPath = iframe.style.getPropertyValue('clip-path');
    const boundsMessage = {
      type: AI_MODAL_BOUNDS_MESSAGE,
      bounds: { x: 120, y: 80, width: 640, height: 480 },
    };

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      origin: 'https://extension.local',
      data: boundsMessage,
    }));
    window.dispatchEvent(new MessageEvent('message', {
      source: iframe.contentWindow,
      origin: 'https://attacker.example',
      data: boundsMessage,
    }));

    expect(iframe.style.getPropertyValue('clip-path')).toBe(initialClipPath);
  });

  it('uses summarize as the primary floating action when configured', async () => {
    const runtime = createChromeMock({
      enableFloatingSummarize: true,
      enableAiFeatures: true,
      floatingPrimaryAction: 'summarize',
      localApiKey: 'local-key',
      storedSummariesByContentId: { 12345: true },
      ensurePermission: { granted: true, error: '' },
    });
    global.chrome = runtime.chrome;

    const { bootstrapContentApp } = await loadContentAppModule();
    bootstrapContentApp();
    await flushMany();

    const mainButton = document.querySelector('.enhanced-fab-main');
    expect(mainButton?.classList.contains('enhanced-fab-summarize')).toBe(true);

    const splitButtons = Array.from(document.querySelectorAll('.enhanced-fab-split .enhanced-fab-btn'));
    expect(splitButtons[0]?.classList.contains('enhanced-fab-summarize')).toBe(true);
    expect(splitButtons[1]?.classList.contains('enhanced-fab-open')).toBe(true);

    act(() => {
      mainButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMany();

    expect(document.getElementById(MODAL_HOST_ID)).toBeTruthy();
    expect(runtime.runtimeSendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      action: 'openSearchTab',
    }));
  });

  it('hides summarize action until AI is enabled and API key exists', async () => {
    const runtime = createChromeMock({
      enableFloatingSummarize: true,
      enableAiFeatures: false,
      localApiKey: 'local-key',
    });
    global.chrome = runtime.chrome;

    const { bootstrapContentApp } = await loadContentAppModule();
    bootstrapContentApp();
    await flushMany();

    expect(document.querySelector('.enhanced-fab-btn.enhanced-fab-summarize')).toBeFalsy();
    expect(document.querySelector('.enhanced-fab-main')?.classList.contains('enhanced-fab-open')).toBe(true);

    act(() => {
      runtime.triggerStorageChange({
        enableAiFeatures: { newValue: true },
      });
    });
    await flushMany();
    expect(document.querySelector('.enhanced-fab-btn.enhanced-fab-summarize')).toBeTruthy();
  });

});
