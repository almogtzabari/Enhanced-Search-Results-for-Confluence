import { beforeEach, describe, expect, it, vi } from 'vitest';

function makeResponse({
  ok = true,
  status = 200,
  statusText = 'OK',
  contentType = 'application/json',
  body = '{}',
} = {}) {
  return {
    ok,
    status,
    statusText,
    headers: {
      get(name) {
        if (String(name).toLowerCase() === 'content-type') return contentType;
        return '';
      },
    },
    async text() {
      return body;
    },
  };
}

async function loadConfluenceApi(pathname = '/') {
  vi.resetModules();
  window.history.replaceState({}, '', pathname);
  return import('../confluenceApi.js');
}

describe('confluenceApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    window.history.replaceState({}, '', '/');
    Object.defineProperty(window, 'parent', {
      value: window,
      configurable: true,
    });
    global.fetch = vi.fn();
  });

  it('caches body HTML results by content id and base url', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({
      body: JSON.stringify({
        body: { storage: { value: '<p>Hello</p>' } },
      }),
    }));
    global.fetch = fetchMock;
    const api = await loadConfluenceApi('/views/index.html');
    const sanitizer = vi.fn((value) => `safe:${value}`);

    const first = await api.fetchConfluenceBodyById(
      'https://example.atlassian.net/wiki',
      '55',
      { sanitizeHtmlFragment: sanitizer },
    );
    const second = await api.fetchConfluenceBodyById(
      'https://example.atlassian.net/wiki',
      '55',
      { sanitizeHtmlFragment: sanitizer },
    );

    expect(first).toBe('safe:<p>Hello</p>');
    expect(second).toBe('safe:<p>Hello</p>');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back across base-url candidates when earlier response is non-JSON', async () => {
    const fetchMock = vi.fn(async (url) => {
      if (url === 'https://example.atlassian.net/confluence/rest/api/content/55?expand=body.storage') {
        return makeResponse({
          contentType: 'text/html',
          body: '<html>not json</html>',
        });
      }
      if (url === 'https://example.atlassian.net/wiki/rest/api/content/55?expand=body.storage') {
        return makeResponse({
          contentType: 'application/json',
          body: JSON.stringify({
            body: { storage: { value: '<p>FromWiki</p>' } },
          }),
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    global.fetch = fetchMock;
    const api = await loadConfluenceApi('/views/index.html');

    const body = await api.fetchConfluenceBodyById(
      'https://example.atlassian.net/confluence',
      '55',
      { force: true, sanitizeHtmlFragment: (value) => value },
    );

    expect(body).toBe('<p>FromWiki</p>');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.atlassian.net/confluence/rest/api/content/55?expand=body.storage');
    expect(fetchMock.mock.calls[1][0]).toBe('https://example.atlassian.net/wiki/rest/api/content/55?expand=body.storage');
  });

  it('uses host bridge in content-modal mode and skips direct fetch when bridge succeeds', async () => {
    const bridgeParent = { postMessage: vi.fn() };
    Object.defineProperty(window, 'parent', {
      value: bridgeParent,
      configurable: true,
    });
    const messageHandlers = [];
    const originalAdd = window.addEventListener.bind(window);
    const originalRemove = window.removeEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation((type, handler, options) => {
      if (type === 'message') {
        messageHandlers.push(handler);
        return;
      }
      originalAdd(type, handler, options);
    });
    vi.spyOn(window, 'removeEventListener').mockImplementation((type, handler, options) => {
      if (type === 'message') {
        const idx = messageHandlers.indexOf(handler);
        if (idx >= 0) messageHandlers.splice(idx, 1);
        return;
      }
      originalRemove(type, handler, options);
    });
    const fetchMock = vi.fn();
    global.fetch = fetchMock;

    bridgeParent.postMessage.mockImplementation((payload) => {
      const handler = messageHandlers[messageHandlers.length - 1];
      if (!handler) return;
      queueMicrotask(() => {
        handler({
          source: bridgeParent,
          origin: 'https://example.atlassian.net',
          data: {
            type: 'enhanced-ai-modal-fetch-result',
            requestId: payload.requestId,
            ok: true,
            status: 200,
            statusText: 'OK',
            contentType: 'application/json',
            body: JSON.stringify({ id: '123', title: 'FromBridge' }),
          },
        });
      });
    });

    const api = await loadConfluenceApi('/views/index.html?mode=content-modal&baseUrl=https%3A%2F%2Fexample.atlassian.net%2Fwiki');
    const data = await api.fetchConfluenceMetadataById('https://example.atlassian.net/wiki', '123');

    expect(data.id).toBe('123');
    expect(bridgeParent.postMessage).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to direct fetch in content-modal mode when bridge is unavailable', async () => {
    Object.defineProperty(window, 'parent', {
      value: window,
      configurable: true,
    });
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({
      body: JSON.stringify({ id: '222', title: 'DirectFetch' }),
    }));
    global.fetch = fetchMock;
    const api = await loadConfluenceApi('/views/index.html?mode=content-modal&baseUrl=https%3A%2F%2Fexample.atlassian.net%2Fwiki');

    const data = await api.fetchConfluenceMetadataById('https://example.atlassian.net/wiki', '222');

    expect(data.id).toBe('222');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/wiki/rest/api/content/222?expand=space.icon,history.createdBy,history.lastUpdated.by,version.by,version,ancestors');
  });

  it('rejects image bridge calls when host origin cannot be determined', async () => {
    const bridgeParent = { postMessage: vi.fn() };
    Object.defineProperty(window, 'parent', {
      value: bridgeParent,
      configurable: true,
    });
    const api = await loadConfluenceApi('/views/index.html?mode=content-modal');

    await expect(
      api.fetchImageDataUrlViaHostBridge('https://example.atlassian.net/wiki/download/image.png', 10),
    ).rejects.toThrow('Host image bridge origin is unknown');
  });
});
