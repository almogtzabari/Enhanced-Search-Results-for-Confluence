import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { normalizeResponsesUrl } from './shared/openai.js';
import {
  AI_MODAL_BOUNDS_MESSAGE,
  AI_MODAL_THEME_MESSAGE,
  SUMMARY_STORE,
} from './shared/constants.js';

const LOADER_FLAG = '__enhancedConfluenceContentAppLoaded';
const ROOT_ID = 'enhanced-content-app-root';
const MODAL_HOST_ID = 'enhanced-content-ai-modal-host';
const MODAL_IFRAME_ID = 'enhanced-content-ai-modal-frame';
const MODAL_CLOSE_MESSAGE = 'enhanced-ai-modal-close';
const AI_MODAL_FETCH_MESSAGE = 'enhanced-ai-modal-fetch';
const AI_MODAL_FETCH_RESULT_MESSAGE = 'enhanced-ai-modal-fetch-result';
const AI_MODAL_FETCH_IMAGE_MESSAGE = 'enhanced-ai-modal-fetch-image';
const AI_MODAL_FETCH_IMAGE_RESULT_MESSAGE = 'enhanced-ai-modal-fetch-image-result';
const FLOATING_PRIMARY_ACTION_SEARCH = 'search';
const FLOATING_PRIMARY_ACTION_SUMMARIZE = 'summarize';
const FLOATING_PRIMARY_ACTION_DEFAULT = FLOATING_PRIMARY_ACTION_SEARCH;
const PREFETCH_TTL_MS = 45_000;
const PREFETCH_METADATA_TIMEOUT_MS = 4_000;
const PREFETCH_IDLE_DELAY_MS = 450;
const MODAL_CLIP_BORDER_RADIUS_PX = 16;

function detectConfluenceTheme() {
  const roots = [document.documentElement, document.body].filter(Boolean);
  for (const root of roots) {
    const colorMode = String(root.getAttribute('data-color-mode') || '').trim().toLowerCase();
    if (colorMode === 'dark' || colorMode === 'light') return colorMode;
  }

  for (const root of roots) {
    const colorScheme = String(window.getComputedStyle(root).colorScheme || '').trim().toLowerCase();
    if (colorScheme === 'dark' || colorScheme === 'light') return colorScheme;
  }

  return '';
}

function normalizeModalBounds(rawBounds) {
  const { x, y, width, height } = rawBounds || {};
  if (![x, y, width, height].every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return null;
  }
  if (width <= 0 || height <= 0) return null;

  const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
  const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
  const left = Math.max(0, Math.min(viewportWidth, x));
  const top = Math.max(0, Math.min(viewportHeight, y));
  const rightEdge = Math.max(left, Math.min(viewportWidth, x + width));
  const bottomEdge = Math.max(top, Math.min(viewportHeight, y + height));
  if (rightEdge <= left || bottomEdge <= top) return null;

  return {
    top,
    right: viewportWidth - rightEdge,
    bottom: viewportHeight - bottomEdge,
    left,
  };
}

function applyModalIframeClip(iframe, rawBounds) {
  const bounds = normalizeModalBounds(rawBounds);
  if (!bounds) return false;
  const clipPath = `inset(${bounds.top}px ${bounds.right}px ${bounds.bottom}px ${bounds.left}px round ${MODAL_CLIP_BORDER_RADIUS_PX}px)`;
  // Keep clipping as geometry. Replacing an SVG mask image on every resize frame
  // makes Gecko repeatedly rasterize the full-viewport iframe and can flash.
  iframe.style.setProperty('clip-path', clipPath, 'important');
  return true;
}

function getFallbackModalBounds() {
  const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
  const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
  const width = Math.min(viewportWidth - 24, Math.max(640, viewportWidth * 0.76));
  const height = Math.min(viewportHeight - 32, Math.max(480, viewportHeight * 0.7));
  return {
    x: (viewportWidth - width) / 2,
    y: (viewportHeight - height) / 2,
    width,
    height,
  };
}

function normalizeFloatingPrimaryAction(value) {
  if (value === FLOATING_PRIMARY_ACTION_SEARCH) return FLOATING_PRIMARY_ACTION_SEARCH;
  if (value === FLOATING_PRIMARY_ACTION_SUMMARIZE) return FLOATING_PRIMARY_ACTION_SUMMARIZE;
  return FLOATING_PRIMARY_ACTION_DEFAULT;
}

function toHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ''), window.location.href);
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildAllowedBridgeOrigins(baseUrl) {
  const origins = new Set();
  origins.add(window.location.origin);
  const parsedBase = toHttpUrl(baseUrl);
  if (parsedBase) origins.add(parsedBase.origin);
  return origins;
}

function isAllowedBridgeUrl(rawUrl, allowedOrigins) {
  const parsed = toHttpUrl(rawUrl);
  if (!parsed) return false;
  return allowedOrigins.has(parsed.origin);
}

function isAllowedBridgeApiUrl(rawUrl, allowedOrigins) {
  const parsed = toHttpUrl(rawUrl);
  if (!parsed) return false;
  if (!allowedOrigins.has(parsed.origin)) return false;
  return /\/rest\/api\//.test(parsed.pathname);
}

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

function normalizeBaseUrlForKey(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '').toLowerCase();
}

function buildConfluenceBaseCandidates(baseInput = '') {
  const candidates = [];
  const seen = new Set();
  const pushCandidate = (base) => {
    const normalized = String(base || '').replace(/\/+$/, '');
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  const detectedBase = baseInput || detectConfluenceBaseUrl();
  pushCandidate(detectedBase);
  try {
    const parsed = new URL(detectedBase);
    const origin = parsed.origin.replace(/\/+$/, '');
    const contextPath = parsed.pathname.replace(/\/+$/, '');
    if (contextPath && contextPath !== '/') pushCandidate(`${origin}${contextPath}`);
    pushCandidate(`${origin}/wiki`);
    pushCandidate(origin);
  } catch {
    pushCandidate(window.location.origin);
    pushCandidate(`${window.location.origin.replace(/\/+$/, '')}/wiki`);
  }

  return candidates;
}

function withTimeout(promise, timeoutMs, fallback = null) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, timeoutMs);

    promise
      .then((result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

function pickFirstNonEmpty(values = []) {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function readMetaContent(candidates = []) {
  for (const name of candidates) {
    const value = document.querySelector(`meta[name="${name}"]`)?.getAttribute('content');
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function readAjsValue(candidates = []) {
  for (const key of candidates) {
    let value = '';
    try {
      const metaGetter = window.AJS?.Meta?.get;
      if (typeof metaGetter === 'function') {
        value = metaGetter.call(window.AJS.Meta, key);
      }
    } catch {
      value = '';
    }
    if (!value) value = window.AJS?.params?.[key];
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function normalizeMetadataSnapshot(raw = null) {
  if (!raw || typeof raw !== 'object') return null;
  const normalized = {
    id: normalizeConfluenceId(raw.id) || '',
    title: String(raw.title || '').trim(),
    type: String(raw.type || '').trim(),
    webUi: String(raw.webUi || '').trim(),
    spaceName: String(raw.spaceName || '').trim(),
    spaceKey: String(raw.spaceKey || '').trim(),
    spaceIconPath: String(raw.spaceIconPath || '').trim(),
    contributorName: String(raw.contributorName || '').trim(),
    contributorUsername: String(raw.contributorUsername || '').trim(),
    contributorAvatarPath: String(raw.contributorAvatarPath || '').trim(),
    modifiedWhen: String(raw.modifiedWhen || '').trim(),
  };
  return normalized;
}

function mergeMetadataSnapshot(primary = null, fallback = null) {
  const base = normalizeMetadataSnapshot(fallback) || {};
  const override = normalizeMetadataSnapshot(primary) || {};
  const merged = { ...base, ...override };
  return normalizeMetadataSnapshot(merged);
}

function hasLoaderIdentityMetadata(metadata = null) {
  const normalized = normalizeMetadataSnapshot(metadata);
  if (!normalized) return false;
  const hasSpace = Boolean(normalized.spaceName || normalized.spaceKey);
  const hasContributor = Boolean(normalized.contributorName || normalized.contributorUsername);
  return hasSpace && hasContributor;
}

function deriveRuntimeMetadataSnapshot(contentId, contentTitle = '') {
  const pageTitle = pickFirstNonEmpty([
    contentTitle,
    readMetaContent(['ajs-page-title', 'ajs-title']),
    readAjsValue(['page-title', 'pageTitle', 'title']),
    document.title,
  ]);
  const pageType = pickFirstNonEmpty([
    readMetaContent(['ajs-content-type', 'ajs-page-type']),
    readAjsValue(['content-type', 'contentType', 'page-type', 'pageType']),
    'page',
  ]);
  const spaceName = pickFirstNonEmpty([
    readMetaContent(['ajs-space-name']),
    readAjsValue(['space-name', 'spaceName']),
  ]);
  const spaceKey = pickFirstNonEmpty([
    readMetaContent(['ajs-space-key']),
    readAjsValue(['space-key', 'spaceKey']),
  ]);
  const contributorName = pickFirstNonEmpty([
    readMetaContent([
      'ajs-page-author-display-name',
      'ajs-creator-display-name',
      'ajs-page-author-name',
      'ajs-creator-name',
    ]),
    readAjsValue([
      'page-author-display-name',
      'pageAuthorDisplayName',
      'creator-display-name',
      'creatorDisplayName',
      'page-author-name',
      'pageAuthorName',
      'creator-name',
      'creatorName',
    ]),
  ]);
  const contributorUsername = pickFirstNonEmpty([
    readMetaContent(['ajs-page-author', 'ajs-creator']),
    readAjsValue(['page-author', 'pageAuthor', 'creator', 'remoteUser', 'remote-user']),
  ]);
  const contributorAvatarPath = pickFirstNonEmpty([
    readMetaContent(['ajs-page-author-avatar', 'ajs-creator-avatar']),
    readAjsValue(['page-author-avatar', 'pageAuthorAvatar', 'creator-avatar', 'creatorAvatar']),
  ]);
  const modifiedWhen = pickFirstNonEmpty([
    readMetaContent(['ajs-page-modified-date']),
    readAjsValue(['page-modified-date', 'pageModifiedDate']),
  ]);
  const webUi = pickFirstNonEmpty([
    readAjsValue(['content-webui', 'contentWebUi', 'page-webui', 'pageWebUi']),
    `${window.location.pathname || ''}${window.location.search || ''}`,
  ]);

  return normalizeMetadataSnapshot({
    id: contentId,
    title: pageTitle,
    type: pageType,
    webUi,
    spaceName,
    spaceKey,
    spaceIconPath: '',
    contributorName,
    contributorUsername,
    contributorAvatarPath,
    modifiedWhen,
  });
}

function selectContributorCandidate(raw = null) {
  const createdBy = raw?.history?.createdBy;
  const lastUpdatedBy = raw?.history?.lastUpdated?.by;
  const versionBy = raw?.version?.by;
  const candidates = [createdBy, lastUpdatedBy, versionBy];
  const withSignal = candidates.find((candidate) => (
    candidate
    && typeof candidate === 'object'
    && (
      candidate?.displayName
      || candidate?.publicName
      || candidate?.fullName
      || candidate?.username
      || candidate?.userKey
      || candidate?.accountId
      || candidate?.profilePicture?.path
    )
  ));
  if (withSignal) return withSignal;
  const firstObject = candidates.find((candidate) => candidate && typeof candidate === 'object');
  return firstObject || {};
}

async function fetchPageMetadataSnapshot(baseUrl, contentId) {
  const normalizedId = normalizeConfluenceId(contentId);
  if (!normalizedId) return null;
  const candidates = buildConfluenceBaseCandidates(baseUrl);

  for (const candidate of candidates) {
    try {
      const response = await fetch(
        `${candidate}/rest/api/content/${encodeURIComponent(normalizedId)}?expand=space.icon,history.createdBy,history.lastUpdated.by,version.by,version,_links`,
        {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        },
      );
      if (!response.ok) continue;
      const data = await response.json();
      const contributor = selectContributorCandidate(data);
      const contributorName = pickFirstNonEmpty([
        contributor?.displayName,
        contributor?.publicName,
        contributor?.fullName,
        contributor?.username,
        contributor?.userKey,
        contributor?.accountId,
      ]);
      const contributorIdentity = pickFirstNonEmpty([
        contributor?.username,
        contributor?.userKey,
        contributor?.accountId,
      ]);
      const contributorAvatarPath = pickFirstNonEmpty([
        contributor?.profilePicture?.path,
      ]);
      const modifiedWhen = pickFirstNonEmpty([
        data?.version?.when,
        data?.history?.lastUpdated?.when,
      ]);
      return {
        id: normalizedId,
        title: String(data?.title || '').trim(),
        type: String(data?.type || '').trim(),
        webUi: String(data?._links?.webui || '').trim(),
        spaceName: String(data?.space?.name || '').trim(),
        spaceKey: String(data?.space?.key || '').trim(),
        spaceIconPath: String(data?.space?.icon?.path || '').trim(),
        contributorName,
        contributorUsername: contributorIdentity,
        contributorAvatarPath,
        modifiedWhen,
      };
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

function ensureContentStyles() {
  const existing = document.getElementById('enhanced-content-script-styles');
  if (existing) return existing;

  const styleLink = document.createElement('link');
  styleLink.id = 'enhanced-content-script-styles';
  styleLink.rel = 'stylesheet';
  styleLink.href = chrome.runtime.getURL('extension/content/modalStyles.css');
  document.head.appendChild(styleLink);
  return styleLink;
}

function removeContentModalHost() {
  const existing = document.getElementById(MODAL_HOST_ID);
  if (existing) existing.remove();
  if (typeof window.__enhancedContentModalCleanup === 'function') {
    window.__enhancedContentModalCleanup = null;
  }
}

function openSharedAiModal(contentId, baseUrl, contentTitle, options = {}, onClosed) {
  const { prefetchedMetadata = null } = options || {};
  removeContentModalHost();

  const host = document.createElement('div');
  host.id = MODAL_HOST_ID;
  host.style.position = 'fixed';
  host.style.inset = '0';
  host.style.zIndex = '2147483000';
  host.style.display = 'block';
  host.style.background = 'rgba(15, 24, 37, 0.52)';
  host.style.backdropFilter = 'blur(2px)';
  host.style.webkitBackdropFilter = 'blur(2px)';

  const iframe = document.createElement('iframe');
  iframe.id = MODAL_IFRAME_ID;
  iframe.setAttribute('allow', 'clipboard-read; clipboard-write');
  iframe.setAttribute('width', '100%');
  iframe.setAttribute('height', '100%');
  iframe.style.position = 'absolute';
  iframe.style.inset = '0';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = '0';
  iframe.style.borderRadius = '0';
  iframe.style.overflow = 'hidden';
  iframe.style.background = 'transparent';
  iframe.style.boxShadow = 'none';
  iframe.style.display = 'block';
  iframe.style.opacity = '0';
  iframe.style.willChange = 'clip-path';
  iframe.style.setProperty(
    'clip-path',
    `inset(50% round ${MODAL_CLIP_BORDER_RADIUS_PX}px)`,
    'important',
  );
  iframe.style.transition = 'opacity 140ms ease';

  const bootstrapOverlay = document.createElement('div');
  bootstrapOverlay.style.position = 'absolute';
  bootstrapOverlay.style.inset = '0';
  bootstrapOverlay.style.display = 'grid';
  bootstrapOverlay.style.placeItems = 'center';
  bootstrapOverlay.style.pointerEvents = 'none';
  bootstrapOverlay.style.zIndex = '1';

  const modalParams = new URLSearchParams({
    mode: 'content-modal',
    baseUrl: String(baseUrl || ''),
    contentId: String(contentId || ''),
    contentTitle: String(contentTitle || ''),
  });
  const initialConfluenceTheme = detectConfluenceTheme();
  if (initialConfluenceTheme) modalParams.set('hostTheme', initialConfluenceTheme);
  if (prefetchedMetadata) {
    const prefetchedPairs = [
      ['prefetched', '1'],
      ['contentType', prefetchedMetadata.type],
      ['contentWebUi', prefetchedMetadata.webUi],
      ['spaceName', prefetchedMetadata.spaceName],
      ['spaceKey', prefetchedMetadata.spaceKey],
      ['spaceIconPath', prefetchedMetadata.spaceIconPath],
      ['contributorName', prefetchedMetadata.contributorName],
      ['contributorUsername', prefetchedMetadata.contributorUsername],
      ['contributorAvatarPath', prefetchedMetadata.contributorAvatarPath],
      ['modifiedWhen', prefetchedMetadata.modifiedWhen],
    ];
    prefetchedPairs.forEach(([key, value]) => {
      const normalized = String(value || '').trim();
      if (!normalized) return;
      modalParams.set(key, normalized);
    });
  }
  const iframeUrl = `${chrome.runtime.getURL('views/index.html')}?${modalParams.toString()}`;
  const iframeOrigin = new URL(iframeUrl).origin;
  const allowedBridgeOrigins = buildAllowedBridgeOrigins(baseUrl);

  const postToIframe = (payload) => {
    iframe.contentWindow?.postMessage(payload, iframeOrigin);
  };

  let lastPostedTheme = '';
  const postConfluenceTheme = ({ force = false } = {}) => {
    const theme = detectConfluenceTheme();
    if (!theme || (!force && theme === lastPostedTheme)) return;
    lastPostedTheme = theme;
    postToIframe({ type: AI_MODAL_THEME_MESSAGE, theme });
  };

  const themeObserver = new MutationObserver(() => postConfluenceTheme());
  [document.documentElement, document.body].filter(Boolean).forEach((root) => {
    themeObserver.observe(root, {
      attributes: true,
      attributeFilter: ['data-color-mode', 'data-theme', 'class', 'style'],
    });
  });

  let closed = false;
  let frameLoaded = false;
  let modalBoundsReady = false;
  let revealTimerId = 0;
  const revealIframe = () => {
    if (closed) return;
    if (!frameLoaded || !modalBoundsReady) return;
    iframe.style.opacity = '1';
    if (bootstrapOverlay.parentElement) bootstrapOverlay.remove();
    iframe.removeEventListener('load', onFrameLoad);
    if (revealTimerId) {
      window.clearTimeout(revealTimerId);
      revealTimerId = 0;
    }
  };
  const onFrameLoad = () => {
    let frameHref = '';
    try {
      frameHref = String(iframe.contentWindow?.location?.href || '');
    } catch {
      frameHref = '';
    }
    if (frameHref === 'about:blank') return;
    frameLoaded = true;
    postConfluenceTheme({ force: true });
    revealIframe();
  };
  const cleanup = () => {
    if (closed) return;
    closed = true;
    iframe.removeEventListener('load', onFrameLoad);
    if (revealTimerId) {
      window.clearTimeout(revealTimerId);
      revealTimerId = 0;
    }
    themeObserver.disconnect();
    window.removeEventListener('message', onMessage);
    host.remove();
    if (window.__enhancedContentModalCleanup === cleanup) {
      window.__enhancedContentModalCleanup = null;
    }
    if (typeof onClosed === 'function') onClosed();
  };

  const onMessage = async (event) => {
    if (event.source !== iframe.contentWindow) return;
    if (event.origin !== iframeOrigin) return;
    const payload = event.data || {};
    const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
    const requestUrl = typeof payload.url === 'string' ? payload.url : '';

    const respondFetchError = (errorMessage) => {
      if (!requestId) return;
      postToIframe({
        type: AI_MODAL_FETCH_RESULT_MESSAGE,
        requestId,
        ok: false,
        status: 0,
        statusText: errorMessage || 'Bridge fetch blocked',
        contentType: '',
        body: '',
      });
    };

    const respondImageError = (errorMessage) => {
      if (!requestId) return;
      postToIframe({
        type: AI_MODAL_FETCH_IMAGE_RESULT_MESSAGE,
        requestId,
        ok: false,
        error: errorMessage || 'Bridge image fetch blocked',
      });
    };

    if (payload.type === MODAL_CLOSE_MESSAGE) {
      cleanup();
      return;
    }

    if (payload.type === AI_MODAL_BOUNDS_MESSAGE) {
      if (!applyModalIframeClip(iframe, payload.bounds)) return;
      modalBoundsReady = true;
      revealIframe();
      return;
    }

    if (payload.type === AI_MODAL_FETCH_MESSAGE) {
      if (!requestId || !requestUrl) return;
      if (!isAllowedBridgeApiUrl(requestUrl, allowedBridgeOrigins)) {
        respondFetchError('Bridge API fetch blocked');
        return;
      }
      try {
        const response = await fetch(requestUrl, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          credentials: 'include',
        });
        const body = await response.text();
        postToIframe({
          type: AI_MODAL_FETCH_RESULT_MESSAGE,
          requestId,
          ok: response.ok,
          status: response.status,
          statusText: response.statusText || '',
          contentType: response.headers.get('content-type') || '',
          body,
        });
      } catch (err) {
        postToIframe({
          type: AI_MODAL_FETCH_RESULT_MESSAGE,
          requestId,
          ok: false,
          status: 0,
          statusText: err?.message || 'Bridge fetch failed',
          contentType: '',
          body: '',
        });
      }
      return;
    }

    if (payload.type === AI_MODAL_FETCH_IMAGE_MESSAGE) {
      if (!requestId || !requestUrl) return;
      if (!isAllowedBridgeUrl(requestUrl, allowedBridgeOrigins)) {
        respondImageError('Bridge image fetch blocked for non-Confluence origin');
        return;
      }
      try {
        const response = await fetch(requestUrl, {
          method: 'GET',
          credentials: 'include',
        });
        if (!response.ok) {
          postToIframe({
            type: AI_MODAL_FETCH_IMAGE_RESULT_MESSAGE,
            requestId,
            ok: false,
            error: `HTTP ${response.status} ${response.statusText || ''}`.trim(),
          });
          return;
        }

        const blob = await response.blob();
        const reader = new FileReader();
        reader.onload = () => {
          postToIframe({
            type: AI_MODAL_FETCH_IMAGE_RESULT_MESSAGE,
            requestId,
            ok: true,
            dataUrl: typeof reader.result === 'string' ? reader.result : '',
          });
        };
        reader.onerror = () => {
          postToIframe({
            type: AI_MODAL_FETCH_IMAGE_RESULT_MESSAGE,
            requestId,
            ok: false,
            error: 'Failed to read image response',
          });
        };
        reader.readAsDataURL(blob);
      } catch (err) {
        postToIframe({
          type: AI_MODAL_FETCH_IMAGE_RESULT_MESSAGE,
          requestId,
          ok: false,
          error: err?.message || 'Bridge image fetch failed',
        });
      }
    }
  };

  host.addEventListener('click', (event) => {
    if (event.target === host) cleanup();
  });
  window.addEventListener('message', onMessage);

  // Attach first, then navigate iframe to avoid detached-bootstrap viewport races.
  host.appendChild(bootstrapOverlay);
  host.appendChild(iframe);
  document.body.appendChild(host);
  iframe.addEventListener('load', onFrameLoad);
  revealTimerId = window.setTimeout(() => {
    if (closed || modalBoundsReady) return;
    applyModalIframeClip(iframe, getFallbackModalBounds());
    modalBoundsReady = true;
    revealIframe();
  }, 5000);
  if (!closed) iframe.src = iframeUrl;

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
  const detectedBase = detectConfluenceBaseUrl();
  const candidates = buildConfluenceBaseCandidates(detectedBase);

  const query = `spaceKey=${encodeURIComponent(spaceKey)}&title=${encodeURIComponent(title)}`;

  for (const base of candidates) {
    try {
      const response = await fetch(`${base}/rest/api/content?${query}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) continue;
      const data = await response.json();
      const resolvedId = normalizeConfluenceId(data?.results?.[0]?.id);
      if (resolvedId) return resolvedId;
    } catch {
      // Try the next base candidate.
    }
  }

  return null;
}

async function getStoredSummaryStatus(contentId, baseUrl) {
  if (!contentId) return false;
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        dbAction: true,
        store: SUMMARY_STORE,
        mode: 'readonly',
        op: 'get',
        payload: [contentId, baseUrl],
      },
      (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          resolve(false);
          return;
        }
        resolve(Boolean(response?.result?.summaryHtml));
      },
    );
  });
}

async function hasConfiguredOpenAiKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['openaiApiKey'], (localData) => {
      const localKey = typeof localData?.openaiApiKey === 'string' ? localData.openaiApiKey.trim() : '';
      if (localKey) {
        resolve(true);
        return;
      }

      chrome.storage.sync.get(['openaiApiKey'], (syncData) => {
        const legacySyncKey = typeof syncData?.openaiApiKey === 'string' ? syncData.openaiApiKey.trim() : '';
        resolve(Boolean(legacySyncKey));
      });
    });
  });
}

async function isAiFeaturesEnabled() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['enableAiFeatures', 'enableSummaries', 'enableFloatingSummarize'], (syncData) => {
      const hasAiFeaturesFlag = typeof syncData?.enableAiFeatures === 'boolean';
      const hasSummariesFlag = typeof syncData?.enableSummaries === 'boolean';
      const hasFloatingFlag = typeof syncData?.enableFloatingSummarize === 'boolean';

      if (hasAiFeaturesFlag) {
        resolve(syncData.enableAiFeatures === true);
        return;
      }

      if (hasSummariesFlag || hasFloatingFlag) {
        resolve((syncData.enableSummaries !== false) || (syncData.enableFloatingSummarize !== false));
        return;
      }

      resolve(false);
    });
  });
}

async function canUseAiSummaryActions() {
  const [aiEnabled, hasApiKey] = await Promise.all([
    isAiFeaturesEnabled(),
    hasConfiguredOpenAiKey(),
  ]);
  return aiEnabled && hasApiKey;
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

function requestApiOriginPermissionFromBackground(origin, { requestIfMissing = false } = {}) {
  return new Promise((resolve) => {
    if (!origin) {
      resolve({ granted: false, error: 'Invalid API origin' });
      return;
    }

    chrome.runtime.sendMessage(
      { action: 'ensureApiOriginPermission', origin, requestIfMissing },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({
            granted: false,
            error: chrome.runtime.lastError.message || 'Failed to check endpoint permission',
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
    url: chrome.runtime.getURL('options/options.html'),
  });
}

function FloatingSummarizeButton({
  initialFloatingPrimaryAction = FLOATING_PRIMARY_ACTION_DEFAULT,
  initialHasStoredSummary = false,
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [uiReady, setUiReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasStoredSummary, setHasStoredSummary] = useState(!!initialHasStoredSummary);
  const [canUseAiActions, setCanUseAiActions] = useState(false);
  const [floatingPrimaryAction, setFloatingPrimaryAction] = useState(
    normalizeFloatingPrimaryAction(initialFloatingPrimaryAction),
  );
  const [dialogState, setDialogState] = useState({ open: false, title: '', message: '' });
  const shellRef = useRef(null);
  const summaryStatusRequestSeqRef = useRef(0);
  const prefetchRequestSeqRef = useRef(0);
  const prefetchStateRef = useRef({
    key: '',
    snapshot: null,
    pendingPromise: null,
  });
  const prefetchIdleCancelRef = useRef(null);
  const expandUnlockTimerRef = useRef(null);
  const canExpandRef = useRef(false);
  const faviconUrl = useMemo(() => chrome.runtime.getURL('assets/icons/favicon.png'), []);

  const closeDialog = () => setDialogState({ open: false, title: '', message: '' });
  const showDialog = (title, message) => setDialogState({ open: true, title, message });

  useEffect(() => {
    setFloatingPrimaryAction(normalizeFloatingPrimaryAction(initialFloatingPrimaryAction));
  }, [initialFloatingPrimaryAction]);

  useEffect(() => {
    setHasStoredSummary(!!initialHasStoredSummary);
  }, [initialHasStoredSummary]);

  useEffect(() => {
    let rafA = 0;
    let rafB = 0;
    const uiReadyFallbackTimer = window.setTimeout(() => setUiReady(true), 320);
    expandUnlockTimerRef.current = window.setTimeout(() => {
      canExpandRef.current = true;
    }, 360);
    rafA = window.requestAnimationFrame(() => {
      rafB = window.requestAnimationFrame(() => {
        setUiReady(true);
      });
    });
    return () => {
      if (rafA) window.cancelAnimationFrame(rafA);
      if (rafB) window.cancelAnimationFrame(rafB);
      window.clearTimeout(uiReadyFallbackTimer);
      if (expandUnlockTimerRef.current) {
        window.clearTimeout(expandUnlockTimerRef.current);
        expandUnlockTimerRef.current = null;
      }
      canExpandRef.current = false;
    };
  }, []);

  const resolvePageContext = async () => {
    const baseUrl = detectConfluenceBaseUrl();
    const contentId = await extractContentIdFromUrl(window.location.pathname);
    return { baseUrl, contentId };
  };

  const buildContextKey = (baseUrl, contentId) => (
    `${String(contentId || '').trim()}::${normalizeBaseUrlForKey(baseUrl)}`
  );

  const readPrefetchedSnapshot = ({ baseUrl, contentId }) => {
    const key = buildContextKey(baseUrl, contentId);
    const existing = prefetchStateRef.current;
    if (!existing?.snapshot || existing.key !== key) return null;
    if ((Date.now() - Number(existing.snapshot.timestamp || 0)) > PREFETCH_TTL_MS) return null;
    return existing.snapshot;
  };

  const upsertPrefetchedSnapshot = (context, patch = {}) => {
    const key = buildContextKey(context.baseUrl, context.contentId);
    const existing = prefetchStateRef.current?.snapshot || {};
    const mergedMetadata = mergeMetadataSnapshot(patch.metadata, existing.metadata);
    const nextSnapshot = {
      ...existing,
      ...patch,
      baseUrl: context.baseUrl,
      contentId: context.contentId,
      metadata: mergedMetadata,
      timestamp: Date.now(),
    };
    prefetchStateRef.current = {
      key,
      snapshot: nextSnapshot,
      pendingPromise: null,
    };
    return nextSnapshot;
  };

  const refreshStoredSummaryStatus = async (contextInput = null) => {
    const { baseUrl, contentId } = contextInput || await resolvePageContext();
    const requestSeq = summaryStatusRequestSeqRef.current + 1;
    summaryStatusRequestSeqRef.current = requestSeq;

    if (!contentId) {
      if (summaryStatusRequestSeqRef.current === requestSeq) setHasStoredSummary(false);
      return { baseUrl, contentId, cachedSummaryAvailable: false };
    }

    const cachedSummaryAvailable = await getStoredSummaryStatus(contentId, baseUrl);
    if (summaryStatusRequestSeqRef.current === requestSeq) {
      setHasStoredSummary(cachedSummaryAvailable);
    }
    const runtimeMetadata = deriveRuntimeMetadataSnapshot(contentId, document.title || '');
    if (contentId) {
      upsertPrefetchedSnapshot(
        { baseUrl, contentId },
        {
          cachedSummaryAvailable,
          contentTitle: runtimeMetadata?.title || document.title || '',
          metadata: runtimeMetadata,
        },
      );
    }
    return { baseUrl, contentId, cachedSummaryAvailable };
  };

  const prefetchPageContext = async ({ force = false } = {}) => {
    const context = await resolvePageContext();
    const { baseUrl, contentId } = context;
    if (!contentId) {
      setHasStoredSummary(false);
      return { baseUrl, contentId: null, cachedSummaryAvailable: false, metadata: null };
    }

    const key = buildContextKey(baseUrl, contentId);
    const existing = prefetchStateRef.current;
    const runtimeMetadata = deriveRuntimeMetadataSnapshot(contentId, document.title || '');
    if (!force && existing.key === key) {
      if (existing.snapshot && (Date.now() - Number(existing.snapshot.timestamp || 0)) <= PREFETCH_TTL_MS) {
        const hydratedSnapshot = {
          ...existing.snapshot,
          metadata: mergeMetadataSnapshot(existing.snapshot?.metadata, runtimeMetadata),
          contentTitle: existing.snapshot?.contentTitle || runtimeMetadata?.title || document.title || '',
        };
        prefetchStateRef.current = {
          ...existing,
          snapshot: hydratedSnapshot,
        };
        if (typeof existing.snapshot.cachedSummaryAvailable === 'boolean') {
          setHasStoredSummary(existing.snapshot.cachedSummaryAvailable);
        }
        if (hasLoaderIdentityMetadata(hydratedSnapshot.metadata)) {
          return hydratedSnapshot;
        }
      }
      if (existing.pendingPromise) return existing.pendingPromise;
    }

    const requestSeq = prefetchRequestSeqRef.current + 1;
    prefetchRequestSeqRef.current = requestSeq;
    const pendingPromise = (async () => {
      const cachedSummaryAvailable = await getStoredSummaryStatus(contentId, baseUrl);
      if (prefetchRequestSeqRef.current === requestSeq) setHasStoredSummary(cachedSummaryAvailable);

      const metadata = await withTimeout(
        fetchPageMetadataSnapshot(baseUrl, contentId),
        PREFETCH_METADATA_TIMEOUT_MS,
        null,
      );
      const mergedMetadata = mergeMetadataSnapshot(metadata, runtimeMetadata);

      const snapshot = upsertPrefetchedSnapshot(
        { baseUrl, contentId },
        {
          cachedSummaryAvailable,
          contentTitle: mergedMetadata?.title || (document.title || ''),
          metadata: mergedMetadata,
        },
      );
      return snapshot;
    })();

    prefetchStateRef.current = {
      key,
      snapshot: existing?.snapshot || null,
      pendingPromise,
    };

    return pendingPromise;
  };

  useEffect(() => {
    ensureContentStyles();
    document.getElementById('enhanced-search-button')?.remove();

    const handleUnhandledRejection = (event) => {
      console.error('[Unhandled Rejection]', event.reason);
    };

    const handleStorageChanged = (changes, area) => {
      if (area === 'sync' && changes.floatingPrimaryAction) {
        setFloatingPrimaryAction(
          normalizeFloatingPrimaryAction(changes.floatingPrimaryAction.newValue),
        );
      }

      if (
        (area === 'sync' && (changes.enableAiFeatures || changes.enableSummaries || changes.enableFloatingSummarize || changes.openaiApiKey))
        || (area === 'local' && changes.openaiApiKey)
      ) {
        void refreshAiActionAvailability();
      }
    };

    const refreshAiActionAvailability = async () => {
      const available = await canUseAiSummaryActions();
      setCanUseAiActions(available);
    };

    const refreshForVisiblePage = () => {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      void prefetchPageContext({ force: true });
    };

    const scheduleInitialPrefetch = () => {
      if (typeof window.requestIdleCallback === 'function') {
        const idleId = window.requestIdleCallback(() => {
          void prefetchPageContext();
        }, { timeout: 1500 });
        prefetchIdleCancelRef.current = () => window.cancelIdleCallback(idleId);
        return;
      }
      const timeoutId = window.setTimeout(() => {
        void prefetchPageContext();
      }, PREFETCH_IDLE_DELAY_MS);
      prefetchIdleCancelRef.current = () => clearTimeout(timeoutId);
    };

    scheduleInitialPrefetch();
    void refreshStoredSummaryStatus();
    void refreshAiActionAvailability();

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('popstate', refreshForVisiblePage);
    window.addEventListener('hashchange', refreshForVisiblePage);
    document.addEventListener('visibilitychange', refreshForVisiblePage);
    chrome.storage.onChanged.addListener(handleStorageChanged);

    return () => {
      if (typeof prefetchIdleCancelRef.current === 'function') {
        prefetchIdleCancelRef.current();
        prefetchIdleCancelRef.current = null;
      }
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('popstate', refreshForVisiblePage);
      window.removeEventListener('hashchange', refreshForVisiblePage);
      document.removeEventListener('visibilitychange', refreshForVisiblePage);
      chrome.storage.onChanged.removeListener(handleStorageChanged);
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

  const expandShell = () => {
    if (!canExpandRef.current) return;
    setIsExpanded(true);
    void prefetchPageContext();
  };

  const onOpenViews = () => openViewsPageFromContent();
  const onOpenOptions = () => openOptionsPageFromContent();

  const onSummarize = async () => {
    if (isLoading) return;
    setIsLoading(true);

    try {
      const {
        baseUrl,
        contentId,
        cachedSummaryAvailable,
      } = await refreshStoredSummaryStatus();
      const prefetched = readPrefetchedSnapshot({ baseUrl, contentId })
        || await prefetchPageContext();
      const prefetchMatchesCurrentPage = (
        prefetched?.contentId === contentId
        && normalizeBaseUrlForKey(prefetched?.baseUrl) === normalizeBaseUrlForKey(baseUrl)
      );
      const runtimeMetadata = deriveRuntimeMetadataSnapshot(contentId, document.title || '');
      const modalMetadata = prefetchMatchesCurrentPage
        ? mergeMetadataSnapshot(prefetched?.metadata, runtimeMetadata)
        : runtimeMetadata;

      if (!contentId) {
        showDialog('Unable to Summarize', 'Cannot determine content ID from URL.');
        return;
      }

      if (!cachedSummaryAvailable) {
        const hasApiKey = await hasConfiguredOpenAiKey();
        if (!hasApiKey) {
          showDialog('OpenAI API Key Missing', 'Please set your OpenAI API key in the extension Options page first.');
          return;
        }

        const endpointOrigin = await getConfiguredOpenAiOrigin();
        if (!endpointOrigin) {
          showDialog('Invalid OpenAI Endpoint', 'Please verify your custom API endpoint in extension options.');
          return;
        }

        const permissionResult = await requestApiOriginPermissionFromBackground(endpointOrigin, { requestIfMissing: false });
        if (!permissionResult.granted) {
          showDialog(
            'Permission Required',
            permissionResult.error || 'Grant endpoint permission from extension Options and try again.',
          );
          return;
        }
      }

      ensureContentStyles();
      openSharedAiModal(
        contentId,
        baseUrl,
        (prefetchMatchesCurrentPage ? prefetched?.contentTitle : '')
          || modalMetadata?.title
          || document.title
          || '',
        { prefetchedMetadata: modalMetadata || null },
        () => {
          void refreshStoredSummaryStatus({ baseUrl, contentId });
        },
      );
    } finally {
      setIsLoading(false);
    }
  };

  const summarizeButtonLabel = hasStoredSummary ? 'Open summary and chat' : 'Summarize and chat';
  const summarizeAriaLabel = hasStoredSummary ? 'Open Existing Summary and Q&A' : 'Open Summary and Q&A';
  const summarizeClassSuffix = hasStoredSummary ? 'has-summary' : '';

  const renderSummarizeIcon = () => {
    if (isLoading) return <span class="inline-spinner inline-spinner-centered" />;

    return (
      <span class={`enhanced-fab-summary-wrap ${summarizeClassSuffix}`.trim()}>
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
        {hasStoredSummary && <span class="enhanced-fab-summary-ready">✓</span>}
      </span>
    );
  };

  const searchAction = {
    key: FLOATING_PRIMARY_ACTION_SEARCH,
    className: 'enhanced-fab-open',
    label: 'Search',
    ariaLabel: 'Open Enhanced Search',
    onClick: onOpenViews,
    disabled: false,
    icon: <img src={faviconUrl} alt="" class="enhanced-fab-icon" />,
  };
  const summarizeAction = {
    key: FLOATING_PRIMARY_ACTION_SUMMARIZE,
    className: `enhanced-fab-summarize ${summarizeClassSuffix}`.trim(),
    label: summarizeButtonLabel,
    ariaLabel: summarizeAriaLabel,
    onClick: onSummarize,
    disabled: isLoading,
    icon: renderSummarizeIcon(),
  };
  const settingsAction = {
    key: 'settings',
    className: 'enhanced-fab-settings',
    label: 'Settings',
    ariaLabel: 'Extension Settings',
    onClick: onOpenOptions,
    disabled: false,
    icon: (
      <svg class="enhanced-fab-settings-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M19.14 12.94a7.48 7.48 0 0 0 .05-.94 7.48 7.48 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.63l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.57.22-1.11.53-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.7 8.85a.5.5 0 0 0 .12.63l2.03 1.58a7.48 7.48 0 0 0-.05.94 7.48 7.48 0 0 0 .05.94L2.82 14.52a.5.5 0 0 0-.12.63l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.41 1.05.72 1.62.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.57-.22 1.11-.53 1.62-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.63l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
          fill="currentColor"
        />
      </svg>
    ),
  };

  const primaryAction = (canUseAiActions && floatingPrimaryAction === FLOATING_PRIMARY_ACTION_SUMMARIZE)
    ? summarizeAction
    : searchAction;
  const splitActions = canUseAiActions
    ? (
      floatingPrimaryAction === FLOATING_PRIMARY_ACTION_SUMMARIZE
        ? [summarizeAction, searchAction, settingsAction]
        : [searchAction, summarizeAction, settingsAction]
    )
    : [searchAction, settingsAction];
  const shellInlineStyle = {
    position: 'fixed',
    bottom: '50px',
    right: '20px',
    zIndex: '10000',
    opacity: uiReady ? '1' : '0',
    visibility: uiReady ? 'visible' : 'hidden',
    pointerEvents: uiReady ? 'auto' : 'none',
  };
  const mainInlineStyle = isExpanded
    ? { opacity: '0', transform: 'translateY(3px) scale(0.84)', pointerEvents: 'none' }
    : undefined;
  const splitInlineStyle = isExpanded
    ? { opacity: '1', transform: 'translateY(0) scale(1)', pointerEvents: 'auto' }
    : { opacity: '0', transform: 'translateY(8px) scale(0.92)', pointerEvents: 'none' };

  return (
    <div
      id="enhanced-fab-shell"
      ref={shellRef}
      class={`enhanced-fab-shell ${isExpanded ? 'expanded' : ''}`}
      style={shellInlineStyle}
      onMouseLeave={() => setIsExpanded(false)}
      onFocusCapture={expandShell}
      onBlurCapture={onShellBlur}
    >
      <button
        class={`enhanced-fab-main ${primaryAction.className}`.trim()}
        type="button"
        aria-label={primaryAction.ariaLabel}
        onMouseEnter={expandShell}
        onFocus={expandShell}
        onClick={primaryAction.onClick}
        disabled={primaryAction.disabled}
        style={mainInlineStyle}
      >
        {primaryAction.icon}
      </button>

      <div class="enhanced-fab-split" style={splitInlineStyle}>
        {splitActions.map((action) => (
          <button
            key={action.key}
            class={`enhanced-fab-btn ${action.className}`.trim()}
            type="button"
            aria-label={action.ariaLabel}
            data-label={action.label}
            onClick={action.onClick}
            disabled={action.disabled}
          >
            {action.icon}
          </button>
        ))}
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
  removeContentModalHost();

  const resolveCurrentSummaryAvailability = async () => {
    const baseUrl = detectConfluenceBaseUrl();
    const contentId = await extractContentIdFromUrl(window.location.pathname);
    if (!contentId) return false;
    return getStoredSummaryStatus(contentId, baseUrl);
  };

  const mountFloatingButton = ({
    initialFloatingPrimaryAction = FLOATING_PRIMARY_ACTION_DEFAULT,
    initialHasStoredSummary = false,
  } = {}) => {
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      document.body.appendChild(root);
    }
    render(
      <FloatingSummarizeButton
        initialFloatingPrimaryAction={initialFloatingPrimaryAction}
        initialHasStoredSummary={initialHasStoredSummary}
      />,
      root,
    );
  };

  let floatingPrimaryActionCache = FLOATING_PRIMARY_ACTION_DEFAULT;
  let applyRequestSeq = 0;

  const applyFloatingSummarizeSetting = async () => {
    const requestSeq = applyRequestSeq + 1;
    applyRequestSeq = requestSeq;

    ensureContentStyles();
    const initialHasStoredSummary = await resolveCurrentSummaryAvailability();
    if (applyRequestSeq !== requestSeq) return;

    mountFloatingButton({
      initialFloatingPrimaryAction: floatingPrimaryActionCache,
      initialHasStoredSummary,
    });
  };

  chrome.storage.sync.get(['floatingPrimaryAction'], ({
    floatingPrimaryAction,
  }) => {
    floatingPrimaryActionCache = normalizeFloatingPrimaryAction(floatingPrimaryAction);
    void applyFloatingSummarizeSetting();
  });

  const onStorageChanged = (changes, area) => {
    if (area !== 'sync') return;
    if (!changes.floatingPrimaryAction) return;
    if (changes.floatingPrimaryAction) {
      floatingPrimaryActionCache = normalizeFloatingPrimaryAction(changes.floatingPrimaryAction.newValue);
    }

    void applyFloatingSummarizeSetting();
  };
  chrome.storage.onChanged.addListener(onStorageChanged);

  window.addEventListener('beforeunload', () => {
    chrome.storage.onChanged.removeListener(onStorageChanged);
    if (typeof window.__enhancedContentModalCleanup === 'function') {
      window.__enhancedContentModalCleanup();
    } else {
      removeContentModalHost();
    }
  }, { once: true });
}
