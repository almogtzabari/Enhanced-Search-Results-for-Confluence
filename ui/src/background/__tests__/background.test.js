import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const backgroundSource = readFileSync(
  resolve(process.cwd(), '../background/background.js'),
  'utf8',
);

function loadBackgroundRuntime({
  manifestVersion = 3,
  domainSettings = [{ domain: 'example.atlassian.net' }],
  hasScripting = true,
  hasTabsExecuteScript = true,
  hasPermissions = true,
  permissionGranted = true,
  hasOpenOptionsPage = true,
} = {}) {
  const runtimeOnMessageListeners = [];
  const runtimeOnConnectListeners = [];
  const runtimeOnInstalledListeners = [];
  const tabUpdatedListeners = [];
  const storageChangedListeners = [];

  const chrome = {
    runtime: {
      lastError: null,
      getManifest: vi.fn(() => (
        manifestVersion >= 3
          ? { manifest_version: manifestVersion, optional_host_permissions: ['https://*/*'] }
          : { manifest_version: manifestVersion, optional_permissions: ['https://*/*'] }
      )),
      getURL: vi.fn((path) => `chrome-extension://test/${path}`),
      openOptionsPage: hasOpenOptionsPage ? vi.fn((callback) => callback?.()) : undefined,
      onMessage: {
        addListener: vi.fn((listener) => runtimeOnMessageListeners.push(listener)),
      },
      onConnect: {
        addListener: vi.fn((listener) => runtimeOnConnectListeners.push(listener)),
      },
      onInstalled: {
        addListener: vi.fn((listener) => runtimeOnInstalledListeners.push(listener)),
      },
    },
    storage: {
      sync: {
        get: vi.fn((key, callback) => {
          if (key === 'domainSettings') {
            callback({ domainSettings });
            return;
          }
          callback({});
        }),
      },
      onChanged: {
        addListener: vi.fn((listener) => storageChangedListeners.push(listener)),
      },
    },
    tabs: {
      create: vi.fn(),
      onUpdated: {
        addListener: vi.fn((listener) => tabUpdatedListeners.push(listener)),
      },
    },
  };

  if (hasTabsExecuteScript) {
    chrome.tabs.executeScript = vi.fn((_tabId, _details, callback) => callback?.());
  }

  if (hasScripting) {
    chrome.scripting = {
      executeScript: vi.fn((_details, callback) => callback?.()),
    };
  }

  if (hasPermissions) {
    chrome.permissions = {
      contains: vi.fn((_query, callback) => callback(permissionGranted)),
      request: vi.fn((_query, callback) => callback(true)),
    };
  }

  const context = vm.createContext({
    chrome,
    console,
    URL,
    URLSearchParams,
    fetch: vi.fn(),
    indexedDB: {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });

  vm.runInContext(backgroundSource, context, { filename: 'background.js' });

  return {
    chrome,
    tabUpdatedListeners,
    runtimeOnMessageListeners,
    runtimeOnConnectListeners,
    runtimeOnInstalledListeners,
    storageChangedListeners,
  };
}

describe('background runtime injection behavior', () => {
  it('injects with chrome.scripting.executeScript when available', () => {
    const runtime = loadBackgroundRuntime({
      hasScripting: true,
      hasTabsExecuteScript: true,
      hasPermissions: true,
      permissionGranted: true,
    });

    expect(runtime.tabUpdatedListeners).toHaveLength(1);
    runtime.tabUpdatedListeners[0](
      101,
      { status: 'complete' },
      { url: 'https://sub.example.atlassian.net/wiki/spaces/ENG' },
    );

    expect(runtime.chrome.permissions.contains).toHaveBeenCalledWith(
      { origins: ['*://example.atlassian.net/*'] },
      expect.any(Function),
    );
    expect(runtime.chrome.scripting.executeScript).toHaveBeenCalledWith(
      { target: { tabId: 101 }, files: ['extension/content/content.js'] },
      expect.any(Function),
    );
    expect(runtime.chrome.tabs.executeScript).not.toHaveBeenCalled();
  });

  it('falls back to chrome.tabs.executeScript when scripting API is unavailable', () => {
    const runtime = loadBackgroundRuntime({
      hasScripting: false,
      hasTabsExecuteScript: true,
      hasPermissions: true,
      permissionGranted: true,
    });

    runtime.tabUpdatedListeners[0](
      202,
      { status: 'complete' },
      { url: 'https://example.atlassian.net/wiki' },
    );

    expect(runtime.chrome.tabs.executeScript).toHaveBeenCalledWith(
      202,
      { file: 'extension/content/content.js' },
      expect.any(Function),
    );
  });

  it('does not inject when optional host permission is missing', () => {
    const runtime = loadBackgroundRuntime({
      hasScripting: true,
      hasTabsExecuteScript: true,
      hasPermissions: true,
      permissionGranted: false,
    });

    runtime.tabUpdatedListeners[0](
      303,
      { status: 'complete' },
      { url: 'https://example.atlassian.net/wiki' },
    );

    expect(runtime.chrome.permissions.contains).toHaveBeenCalledTimes(1);
    expect(runtime.chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(runtime.chrome.tabs.executeScript).not.toHaveBeenCalled();
  });

  it('injects without permission checks when permissions API is unavailable', () => {
    const runtime = loadBackgroundRuntime({
      hasScripting: true,
      hasTabsExecuteScript: true,
      hasPermissions: false,
      permissionGranted: false,
    });

    runtime.tabUpdatedListeners[0](
      404,
      { status: 'complete' },
      { url: 'https://example.atlassian.net/wiki' },
    );

    expect(runtime.chrome.scripting.executeScript).toHaveBeenCalledWith(
      { target: { tabId: 404 }, files: ['extension/content/content.js'] },
      expect.any(Function),
    );
  });

  it('opens options page automatically on install/update', () => {
    const runtime = loadBackgroundRuntime({
      hasOpenOptionsPage: true,
    });

    expect(runtime.runtimeOnInstalledListeners).toHaveLength(1);
    runtime.runtimeOnInstalledListeners[0]({ reason: 'install' });
    expect(runtime.chrome.runtime.openOptionsPage).toHaveBeenCalledTimes(1);

    runtime.runtimeOnInstalledListeners[0]({ reason: 'update' });
    expect(runtime.chrome.runtime.openOptionsPage).toHaveBeenCalledTimes(2);
  });

  it('falls back to opening options tab when openOptionsPage is unavailable', () => {
    const runtime = loadBackgroundRuntime({
      hasOpenOptionsPage: false,
    });

    expect(runtime.runtimeOnInstalledListeners).toHaveLength(1);
    runtime.runtimeOnInstalledListeners[0]({ reason: 'install' });
    expect(runtime.chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test/options/options.html',
    });
  });
});
