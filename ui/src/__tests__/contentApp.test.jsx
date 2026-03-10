import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const LOADER_FLAG = '__enhancedConfluenceContentAppLoaded';
const ROOT_ID = 'enhanced-content-app-root';
const MODAL_HOST_ID = 'enhanced-content-ai-modal-host';

function createChromeMock({
  enableFloatingSummarize = true,
  localApiKey = '',
  syncApiKey = '',
  customApiEndpoint = 'https://api.openai.com/v1',
  ensurePermission = { granted: true, error: '' },
  withOpenOptionsPage = true,
} = {}) {
  let storageChangeListener = null;
  const runtimeSendMessage = vi.fn((message, callback) => {
    if (message?.action === 'ensureApiOriginPermission') {
      callback?.(ensurePermission);
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
    if (keyList.includes('enableFloatingSummarize')) {
      callback({ enableFloatingSummarize });
      return;
    }
    if (keyList.includes('openaiApiKey')) {
      callback({ openaiApiKey: syncApiKey });
      return;
    }
    if (keyList.includes('customApiEndpoint')) {
      callback({ customApiEndpoint });
      return;
    }
    callback({});
  });
  const storageLocalGet = vi.fn((keys, callback) => {
    const keyList = Array.isArray(keys) ? keys : [keys];
    if (keyList.includes('openaiApiKey')) {
      callback({ openaiApiKey: localApiKey });
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
          storageChangeListener = listener;
        }),
        removeListener: vi.fn(),
      },
    },
  };

  return {
    chrome,
    runtimeSendMessage,
    storageSyncGet,
    storageLocalGet,
    triggerStorageChange(changes, area = 'sync') {
      storageChangeListener?.(changes, area);
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

function clickByAriaLabel(label) {
  const el = document.querySelector(`[aria-label="${label}"]`);
  if (!el) throw new Error(`Element with aria-label "${label}" not found`);
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('contentApp', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete window[LOADER_FLAG];
    window.__enhancedContentModalCleanup = null;
    document.head.innerHTML = '';
    document.body.innerHTML = '';
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
    delete window[LOADER_FLAG];
    window.__enhancedContentModalCleanup = null;
  });

  it('bootstraps once and mounts/unmounts with floating summarize setting changes', async () => {
    const runtime = createChromeMock({ enableFloatingSummarize: true });
    global.chrome = runtime.chrome;

    const { bootstrapContentApp } = await loadContentAppModule();
    bootstrapContentApp();
    await flush();

    expect(document.getElementById(ROOT_ID)).toBeTruthy();
    expect(runtime.chrome.storage.onChanged.addListener).toHaveBeenCalledTimes(1);

    bootstrapContentApp();
    await flush();
    expect(document.querySelectorAll(`#${ROOT_ID}`)).toHaveLength(1);

    act(() => {
      runtime.triggerStorageChange({
        enableFloatingSummarize: { newValue: false },
      });
    });
    expect(document.getElementById(ROOT_ID)).toBeFalsy();

    act(() => {
      runtime.triggerStorageChange({
        enableFloatingSummarize: { newValue: true },
      });
    });
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
    await flush();

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
    await flush();

    clickByAriaLabel('Extension Settings');
    expect(runtimeWithOpenOptions.chrome.runtime.openOptionsPage).toHaveBeenCalledTimes(1);

    document.body.innerHTML = '';
    document.head.innerHTML = '';
    delete window[LOADER_FLAG];
    const runtimeWithoutOpenOptions = createChromeMock({ withOpenOptionsPage: false });
    global.chrome = runtimeWithoutOpenOptions.chrome;
    mod = await loadContentAppModule();
    mod.bootstrapContentApp();
    await flush();

    clickByAriaLabel('Extension Settings');
    expect(runtimeWithoutOpenOptions.runtimeSendMessage).toHaveBeenCalledWith({
      action: 'openTab',
      url: 'https://extension.local/options/options.html',
    });
  });

  it('shows missing content id dialog when summarize cannot resolve page id', async () => {
    const runtime = createChromeMock({ enableFloatingSummarize: true });
    global.chrome = runtime.chrome;
    window.history.replaceState({}, '', '/wiki/unknown/location');

    const { bootstrapContentApp } = await loadContentAppModule();
    bootstrapContentApp();
    await flush();

    clickByAriaLabel('Open Summary and Q&A');
    await flush();

    const dialogTitle = document.querySelector('.dialog-content h2');
    expect(dialogTitle?.textContent).toBe('Unable to Summarize');
    expect(document.getElementById(MODAL_HOST_ID)).toBeFalsy();
  });

});
