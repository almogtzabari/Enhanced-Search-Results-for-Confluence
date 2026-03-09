import { h, render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

const LOADER_FLAG = '__enhancedConfluenceContentAppLoaded';
const MODAL_HOST_ID = 'enhanced-content-ai-modal-host';
const MODAL_IFRAME_ID = 'enhanced-content-ai-modal-frame';
const MODAL_CLOSE_MESSAGE = 'enhanced-ai-modal-close';

function normalizeConfluenceId(raw) {
  const value = String(raw || '').trim();
  return /^\d+$/.test(value) ? value : null;
}

function detectConfluenceBaseUrl() {
  const origin = window.location.origin;
  const metaContextPath = document.querySelector('meta[name="ajs-context-path"]')?.getAttribute('content') || '';
  const runtimeContextPath = (window.AJS?.Meta?.get?.('context-path') || window.AJS?.params?.contextPath || '').trim();
  let contextPath = (runtimeContextPath || metaContextPath || '').trim();
  if (!contextPath || contextPath === '/') return origin;
  if (!contextPath.startsWith('/')) contextPath = `/${contextPath}`;
  return `${origin}${contextPath}`;
}

function ensureContentStyles() {
  if (document.getElementById('enhanced-content-script-styles')) return;
  const styleLink = document.createElement('link');
  styleLink.id = 'enhanced-content-script-styles';
  styleLink.rel = 'stylesheet';
  styleLink.href = chrome.runtime.getURL('content/modalStyles.css');
  document.head.appendChild(styleLink);
}

function removeContentModalHost() {
  const existing = document.getElementById(MODAL_HOST_ID);
  if (existing) existing.remove();
  if (typeof window.__enhancedContentModalCleanup === 'function') {
    window.__enhancedContentModalCleanup = null;
  }
}

function openSharedAiModal(contentId, baseUrl, contentTitle, onClosed) {
  removeContentModalHost();

  const host = document.createElement('div');
  host.id = MODAL_HOST_ID;

  const iframe = document.createElement('iframe');
  iframe.id = MODAL_IFRAME_ID;
  iframe.setAttribute('allow', 'clipboard-read; clipboard-write');
  iframe.src = `${chrome.runtime.getURL('views/v2/index.html')}?mode=content-modal&baseUrl=${encodeURIComponent(baseUrl)}&contentId=${encodeURIComponent(contentId)}&contentTitle=${encodeURIComponent(contentTitle || '')}`;

  host.appendChild(iframe);
  document.body.appendChild(host);

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener('message', onMessage);
    host.remove();
    if (window.__enhancedContentModalCleanup === cleanup) {
      window.__enhancedContentModalCleanup = null;
    }
    if (typeof onClosed === 'function') onClosed();
  };

  const onMessage = async (event) => {
    if (event.source !== iframe.contentWindow) return;
    const payload = event.data || {};

    if (payload.type === MODAL_CLOSE_MESSAGE) {
      cleanup();
      return;
    }

    if (payload.type === 'enhanced-ai-modal-fetch') {
      if (!payload.requestId || typeof payload.url !== 'string') return;
      try {
        const response = await fetch(payload.url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          credentials: 'include',
        });
        const body = await response.text();
        iframe.contentWindow?.postMessage({
          type: 'enhanced-ai-modal-fetch-result',
          requestId: payload.requestId,
          ok: response.ok,
          status: response.status,
          statusText: response.statusText || '',
          contentType: response.headers.get('content-type') || '',
          body,
        }, '*');
      } catch (err) {
        iframe.contentWindow?.postMessage({
          type: 'enhanced-ai-modal-fetch-result',
          requestId: payload.requestId,
          ok: false,
          status: 0,
          statusText: err?.message || 'Bridge fetch failed',
          contentType: '',
          body: '',
        }, '*');
      }
      return;
    }

    if (payload.type === 'enhanced-ai-modal-fetch-image') {
      if (!payload.requestId || typeof payload.url !== 'string') return;
      try {
        const response = await fetch(payload.url, {
          method: 'GET',
          credentials: 'include',
        });
        if (!response.ok) {
          iframe.contentWindow?.postMessage({
            type: 'enhanced-ai-modal-fetch-image-result',
            requestId: payload.requestId,
            ok: false,
            error: `HTTP ${response.status} ${response.statusText || ''}`.trim(),
          }, '*');
          return;
        }

        const blob = await response.blob();
        const reader = new FileReader();
        reader.onload = () => {
          iframe.contentWindow?.postMessage({
            type: 'enhanced-ai-modal-fetch-image-result',
            requestId: payload.requestId,
            ok: true,
            dataUrl: typeof reader.result === 'string' ? reader.result : '',
          }, '*');
        };
        reader.onerror = () => {
          iframe.contentWindow?.postMessage({
            type: 'enhanced-ai-modal-fetch-image-result',
            requestId: payload.requestId,
            ok: false,
            error: 'Failed to read image response',
          }, '*');
        };
        reader.readAsDataURL(blob);
      } catch (err) {
        iframe.contentWindow?.postMessage({
          type: 'enhanced-ai-modal-fetch-image-result',
          requestId: payload.requestId,
          ok: false,
          error: err?.message || 'Bridge image fetch failed',
        }, '*');
      }
    }
  };

  host.addEventListener('click', (event) => {
    if (event.target === host) cleanup();
  });
  window.addEventListener('message', onMessage);
  window.__enhancedContentModalCleanup = cleanup;
}

async function extractContentIdFromUrl(pathname) {
  const pageIdMatch = window.location.search.match(/pageId=(\d+)/);
  if (pageIdMatch) return normalizeConfluenceId(pageIdMatch[1]);

  const contentIdMatch = window.location.search.match(/contentId=(\d+)/);
  if (contentIdMatch) return normalizeConfluenceId(contentIdMatch[1]);

  const spacesPageMatch = pathname.match(/\/spaces\/[^/]+\/pages\/(\d+)(?:\/|$)/);
  if (spacesPageMatch) return normalizeConfluenceId(spacesPageMatch[1]);

  const genericPagesMatch = pathname.match(/\/pages\/(\d+)(?:\/|$)/);
  if (genericPagesMatch) return normalizeConfluenceId(genericPagesMatch[1]);

  const meta = document.querySelector('meta[name="ajs-page-id"]');
  if (meta) {
    const metaId = normalizeConfluenceId(meta.getAttribute('content'));
    if (metaId) return metaId;
  }

  if (window.AJS?.params?.pageId) {
    const runtimeId = normalizeConfluenceId(window.AJS.params.pageId);
    if (runtimeId) return runtimeId;
  }

  const pathMatch = pathname.match(/\/pages\/viewpage\.action\?pageId=(\d+)/);
  if (pathMatch) return normalizeConfluenceId(pathMatch[1]);

  const displayMatch = pathname.match(/^\/display\/([^/]+)\/(.+)$/);
  if (!displayMatch) return null;

  const spaceKey = decodeURIComponent(displayMatch[1]);
  const title = decodeURIComponent(displayMatch[2].replace(/\+/g, ' '));

  try {
    const response = await fetch(
      `${window.location.origin}/rest/api/content?spaceKey=${encodeURIComponent(spaceKey)}&title=${encodeURIComponent(title)}`
    );
    if (!response.ok) return null;
    const data = await response.json();
    return normalizeConfluenceId(data?.results?.[0]?.id);
  } catch (error) {
    console.error('Error fetching page ID:', error);
    return null;
  }
}

async function getStoredSummaryStatus(contentId, baseUrl) {
  if (!contentId) return false;
  try {
    const { getStoredSummary } = await import(chrome.runtime.getURL('views/services/dbService.js'));
    const stored = await getStoredSummary(contentId, baseUrl);
    return Boolean(stored?.summaryHtml);
  } catch (error) {
    console.error('Failed to check stored summary status:', error);
    return false;
  }
}

async function hasConfiguredOpenAiKey() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['openaiApiKey'], (data) => {
      const key = typeof data?.openaiApiKey === 'string' ? data.openaiApiKey.trim() : '';
      resolve(Boolean(key));
    });
  });
}

function normalizeResponsesUrl(apiUrl) {
  let sanitizedBase = (apiUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  sanitizedBase = sanitizedBase.replace(/\/chat\/completions$/i, '');
  return /\/responses$/i.test(sanitizedBase) ? sanitizedBase : `${sanitizedBase}/responses`;
}

async function getConfiguredOpenAiOrigin() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['customApiEndpoint'], (data) => {
      const configuredBase = data?.customApiEndpoint?.trim() || 'https://api.openai.com/v1';
      try {
        const origin = new URL(normalizeResponsesUrl(configuredBase)).origin;
        resolve(origin);
      } catch {
        resolve('');
      }
    });
  });
}

function requestApiOriginPermissionFromBackground(origin) {
  return new Promise((resolve) => {
    if (!origin) {
      resolve({ granted: false, error: 'Invalid API origin' });
      return;
    }

    chrome.runtime.sendMessage(
      { action: 'ensureApiOriginPermission', origin },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({
            granted: false,
            error: chrome.runtime.lastError.message || 'Failed to request endpoint permission',
          });
          return;
        }
        resolve({
          granted: !!response?.granted,
          error: response?.error || '',
        });
      },
    );
  });
}

function openViewsPageFromContent(searchText = '') {
  const text = String(searchText || '').trim();
  const baseUrl = detectConfluenceBaseUrl();
  chrome.runtime.sendMessage({
    action: 'openSearchTab',
    searchText: text,
    baseUrl,
    focusSearch: true,
  });
}

function openOptionsPageFromContent() {
  if (chrome.runtime?.openOptionsPage) {
    chrome.runtime.openOptionsPage();
    return;
  }
  chrome.runtime.sendMessage({
    action: 'openTab',
    url: chrome.runtime.getURL('options/v2/options.html'),
  });
}

function FloatingSummarizeButton() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [dialogState, setDialogState] = useState({ open: false, title: '', message: '' });
  const shellRef = useRef(null);
  const faviconUrl = useMemo(() => chrome.runtime.getURL('assets/icons/favicon.png'), []);

  const closeDialog = () => setDialogState({ open: false, title: '', message: '' });
  const showDialog = (title, message) => setDialogState({ open: true, title, message });

  useEffect(() => {
    ensureContentStyles();
    document.getElementById('enhanced-search-button')?.remove();

    const handleUnhandledRejection = (event) => {
      console.error('[Unhandled Rejection]', event.reason);
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      if (typeof window.__enhancedContentModalCleanup === 'function') {
        window.__enhancedContentModalCleanup();
      } else {
        removeContentModalHost();
      }
    };
  }, []);

  useEffect(() => {
    if (!dialogState.open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeDialog();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialogState.open]);

  const onShellBlur = (event) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget && shellRef.current?.contains(nextTarget)) return;
    setIsExpanded(false);
  };

  const onOpenViews = () => openViewsPageFromContent();
  const onOpenOptions = () => openOptionsPageFromContent();

  const onSummarize = async () => {
    if (isLoading) return;
    setIsLoading(true);

    const baseUrl = detectConfluenceBaseUrl();
    const contentId = await extractContentIdFromUrl(window.location.pathname);

    if (!contentId) {
      showDialog('Unable to Summarize', 'Cannot determine content ID from URL.');
      setIsLoading(false);
      return;
    }

    const cachedSummaryAvailable = await getStoredSummaryStatus(contentId, baseUrl);

    if (!cachedSummaryAvailable) {
      const hasApiKey = await hasConfiguredOpenAiKey();
      if (!hasApiKey) {
        showDialog('OpenAI API Key Missing', 'Please set your OpenAI API key in the extension Options page first.');
        setIsLoading(false);
        return;
      }

      const endpointOrigin = await getConfiguredOpenAiOrigin();
      if (!endpointOrigin) {
        showDialog('Invalid OpenAI Endpoint', 'Please verify your custom API endpoint in extension options.');
        setIsLoading(false);
        return;
      }

      const permissionResult = await requestApiOriginPermissionFromBackground(endpointOrigin);
      if (!permissionResult.granted) {
        showDialog(
          'Permission Required',
          permissionResult.error || 'Please allow access to the OpenAI endpoint domain and try again.',
        );
        setIsLoading(false);
        return;
      }
    }

    openSharedAiModal(contentId, baseUrl, document.title || '');

    setIsLoading(false);
  };

  return (
    <div
      id="enhanced-fab-shell"
      ref={shellRef}
      class={`enhanced-fab-shell ${isExpanded ? 'expanded' : ''}`}
      style={{ position: 'fixed', bottom: '50px', right: '20px', zIndex: '10000' }}
      onMouseLeave={() => setIsExpanded(false)}
      onFocusCapture={() => setIsExpanded(true)}
      onBlurCapture={onShellBlur}
    >
      <button
        class="enhanced-fab-main"
        type="button"
        aria-label="Open Enhanced Search"
        onMouseEnter={() => setIsExpanded(true)}
        onFocus={() => setIsExpanded(true)}
        onClick={onOpenViews}
      >
        <img src={faviconUrl} alt="" class="enhanced-fab-icon" />
      </button>

      <div class="enhanced-fab-split">
        <button
          class="enhanced-fab-btn enhanced-fab-open"
          type="button"
          aria-label="Open Enhanced Search"
          data-label="Search"
          onClick={onOpenViews}
        >
          <img src={faviconUrl} alt="" class="enhanced-fab-icon" />
        </button>
        <button
          class="enhanced-fab-btn enhanced-fab-summarize"
          type="button"
          aria-label="Open Summary and Q&A"
          data-label="Summarize and chat"
          onClick={onSummarize}
          disabled={isLoading}
        >
          {isLoading ? (
            <span class="inline-spinner inline-spinner-centered" />
          ) : (
            <svg class="enhanced-fab-summary-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M4.8 5.2h14.4a1.6 1.6 0 0 1 1.6 1.6v8.1a1.6 1.6 0 0 1-1.6 1.6h-7.1l-3.9 3.2v-3.2H4.8a1.6 1.6 0 0 1-1.6-1.6V6.8a1.6 1.6 0 0 1 1.6-1.6Z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linejoin="round"
              />
              <path
                d="M8 9.2h8M8 12h5.8"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
              />
              <circle cx="17.9" cy="18.2" r="2.1" fill="none" stroke="currentColor" stroke-width="1.6" />
              <path d="m19.5 19.8 1.7 1.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
          )}
        </button>
        <button
          class="enhanced-fab-btn enhanced-fab-settings"
          type="button"
          aria-label="Extension Settings"
          data-label="Settings"
          onClick={onOpenOptions}
        >
          <svg class="enhanced-fab-settings-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M19.14 12.94a7.48 7.48 0 0 0 .05-.94 7.48 7.48 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.63l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.57.22-1.11.53-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.7 8.85a.5.5 0 0 0 .12.63l2.03 1.58a7.48 7.48 0 0 0-.05.94 7.48 7.48 0 0 0 .05.94L2.82 14.52a.5.5 0 0 0-.12.63l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.41 1.05.72 1.62.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.57-.22 1.11-.53 1.62-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.63l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>

      {dialogState.open && (
        <div class="dialog-overlay" onClick={closeDialog}>
          <div class="dialog-content" onClick={(event) => event.stopPropagation()}>
            <button class="dialog-close" type="button" aria-label="Close dialog" onClick={closeDialog}>
              ×
            </button>
            <h2>{dialogState.title}</h2>
            <p>{dialogState.message}</p>
            <div class="dialog-actions">
              <button id="dialog-confirm" type="button" onClick={closeDialog}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function bootstrapContentApp() {
  if (window[LOADER_FLAG]) return;
  window[LOADER_FLAG] = true;

  chrome.storage.sync.get(['enableFloatingSummarize'], ({ enableFloatingSummarize }) => {
    if (enableFloatingSummarize === false) return;

    const existingRoot = document.getElementById('enhanced-content-app-root');
    if (existingRoot) return;

    const root = document.createElement('div');
    root.id = 'enhanced-content-app-root';
    document.body.appendChild(root);
    render(<FloatingSummarizeButton />, root);
  });
}
