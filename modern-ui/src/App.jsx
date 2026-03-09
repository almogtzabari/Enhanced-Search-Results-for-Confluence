import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

const typeIcons = {
  page: '📄',
  blogpost: '📰',
  attachment: '📎',
  comment: '💬',
};

const typeLabels = {
  page: 'Page',
  blogpost: 'Blog post',
  attachment: 'Attachment',
  comment: 'Comment',
};

const DEFAULT_AI_MODEL = 'gpt-5.2-chat-latest';
const DEFAULT_AI_MODAL_WIDTH = 1120;
const MIN_AI_MODAL_WIDTH = 640;
const DEFAULT_AI_MODAL_HEIGHT = 760;
const MIN_AI_MODAL_HEIGHT = 480;
const DEFAULT_AI_SUMMARY_PANE_RATIO = 0.3; // 30% summary / 70% Q&A
const MIN_AI_SUMMARY_PANE_RATIO = 0.24;
const MAX_AI_SUMMARY_PANE_RATIO = 0.72;
const DEFAULT_AI_QUESTION_HEIGHT = 96;
const MIN_AI_QUESTION_HEIGHT = 70;
const MAX_AI_QUESTION_HEIGHT = 260;
const OPENAI_REQUEST_TIMEOUT_MS = 120000;
const MIN_TABLE_COL_WIDTH = 70;
const DEFAULT_TABLE_COL_WIDTHS = {
  type: 72,
  name: 440,
  space: 240,
  contributor: 240,
  created: 180,
  modified: 180,
  ai: 116,
};

const AI_MODEL_OPTIONS = [
  { value: 'gpt-5', label: 'gpt-5' },
  { value: 'gpt-5.2-chat-latest', label: 'gpt-5.2-chat-latest' },
  { value: 'gpt-5-pro', label: 'gpt-5-pro' },
  { value: 'gpt-5.2-pro', label: 'gpt-5.2-pro' },
  { value: 'gpt-5.2', label: 'gpt-5.2' },
  { value: 'gpt-5.1', label: 'gpt-5.1' },
  { value: 'gpt-5-mini', label: 'gpt-5-mini' },
  { value: 'gpt-5-nano', label: 'gpt-5-nano' },
  { value: 'gpt-5-chat-latest', label: 'gpt-5-chat-latest' },
];

const retiredModelFallbacks = {
  'gpt-4o': DEFAULT_AI_MODEL,
  'gpt-4.1': DEFAULT_AI_MODEL,
  'gpt-4.1-mini': DEFAULT_AI_MODEL,
  o3: DEFAULT_AI_MODEL,
  'o4-mini': DEFAULT_AI_MODEL,
};

function resolveReasoningEffort(reasoningEffort, useHighReasoningEffort) {
  const normalized = typeof reasoningEffort === 'string' ? reasoningEffort.trim().toLowerCase() : '';
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') return normalized;
  return useHighReasoningEffort ? 'high' : undefined;
}

const summarySystemPrompt = `
You are a technical summarizer. Generate concise, relevant HTML summary for Confluence content.
Use:
1. <h3>What is this about?</h3> and one short paragraph.
2. <h3>Main points</h3> and a short <ul><li> list.
Output valid clean HTML only (no markdown or code fences).
`;

const qaSystemPrompt = `
You answer follow-up questions about a Confluence document.
Respond clearly and use valid clean HTML only (no markdown or code fences).
`;

const confluenceBodyCache = new Map();
let bridgeRequestCounter = 0;

function callDbAction(store, mode, op, payload = null) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ dbAction: true, store, mode, op, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || 'DB message failed'));
        return;
      }
      if (!response?.success) {
        reject(new Error(response?.error || 'Unknown DB error'));
        return;
      }
      resolve(response.result);
    });
  });
}

function getAllSavedSearches() {
  return callDbAction('saved_searches', 'readonly', 'getAll');
}

function storeSavedSearch(entry) {
  return callDbAction('saved_searches', 'readwrite', 'put', entry);
}

function deleteSavedSearch(id) {
  return callDbAction('saved_searches', 'readwrite', 'delete', id);
}

function clearAllSavedSearches() {
  return callDbAction('saved_searches', 'readwrite', 'clear');
}

function getStoredSummary(contentId, baseUrl) {
  return callDbAction('summaries', 'readonly', 'get', [contentId, baseUrl]);
}

function storeSummary(entry) {
  return callDbAction('summaries', 'readwrite', 'put', entry);
}

function getStoredConversation(contentId, baseUrl) {
  return callDbAction('conversations', 'readonly', 'get', [contentId, baseUrl]);
}

function storeConversation(contentId, baseUrl, messages) {
  return callDbAction('conversations', 'readwrite', 'put', {
    contentId,
    baseUrl,
    messages,
    timestamp: Date.now(),
  });
}

function getQueryParams() {
  const url = new URL(window.location.href);
  return Object.fromEntries(url.searchParams.entries());
}

function updateUrlParams(patch) {
  const url = new URL(window.location.href);
  Object.entries(patch).forEach(([key, value]) => {
    if (value === '' || value === null || value === undefined) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, String(value));
    }
  });
  history.replaceState(null, '', url.toString());
}

function formatDate(value) {
  if (!value) return 'N/A';
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return 'N/A';
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function detectDirection(text = '') {
  return /[\u0590-\u05FF\u0600-\u06FF]/.test(text) ? 'rtl' : 'ltr';
}

function stripHtmlToText(html = '') {
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  return (doc.body?.textContent || '').replace(/\s+/g, ' ').trim();
}

function detectDirectionFromHtml(html = '') {
  return detectDirection(stripHtmlToText(html));
}

const fallbackSpaceIcon = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="2.5" y="4" width="19" height="16" rx="3" fill="#e8f1ff" stroke="#4f8ff5"/><path d="M3.8 9h16.4" stroke="#4f8ff5" stroke-width="1.4"/><path d="M8 3v3M16 3v3" stroke="#4f8ff5" stroke-width="1.6" stroke-linecap="round"/></svg>',
)}`;

const fallbackUserIcon = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#eaf2ff" stroke="#7aa6e8"/><circle cx="12" cy="9" r="3" fill="#7aa6e8"/><path d="M6.2 17.4a5.8 5.8 0 0 1 11.6 0" fill="#7aa6e8"/></svg>',
)}`;

function resolveConfluenceIconUrl(baseUrl, maybePath, fallback) {
  if (!maybePath) return fallback;
  if (/^data:/i.test(maybePath)) return maybePath;
  if (/^https?:\/\//i.test(maybePath)) return maybePath;
  if (maybePath.startsWith('//')) return `https:${maybePath}`;
  try {
    return new URL(maybePath, `${String(baseUrl || window.location.origin).replace(/\/+$/, '')}/`).toString();
  } catch {
    return fallback;
  }
}

function extractOutputText(responseData) {
  if (!responseData) return '';
  if (typeof responseData.output_text === 'string' && responseData.output_text.trim()) {
    return responseData.output_text;
  }
  if (Array.isArray(responseData.output)) {
    const chunks = [];
    responseData.output.forEach((item) => {
      if (!Array.isArray(item?.content)) return;
      item.content.forEach((contentItem) => {
        if (contentItem?.type === 'output_text' && typeof contentItem.text === 'string') {
          chunks.push(contentItem.text);
        }
      });
    });
    return chunks.join('\n').trim();
  }
  return '';
}

function normalizeResponsesUrl(apiUrl) {
  let sanitizedBase = (apiUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  sanitizedBase = sanitizedBase.replace(/\/chat\/completions$/i, '');
  return /\/responses$/i.test(sanitizedBase) ? sanitizedBase : `${sanitizedBase}/responses`;
}

function ensureApiOriginPermission(origin, { requestIfMissing = true } = {}) {
  return new Promise((resolve) => {
    const api = globalThis.chrome;
    const isFirefox = typeof InstallTrigger !== 'undefined';
    if (isFirefox || !api?.permissions?.contains || !api?.permissions?.request) {
      resolve({ granted: true, reason: '' });
      return;
    }

    const originPattern = `${origin}/*`;
    api.permissions.contains({ origins: [originPattern] }, (hasPermission) => {
      if (hasPermission) {
        resolve({ granted: true, reason: '' });
        return;
      }

      if (!requestIfMissing) {
        resolve({ granted: false, reason: 'missing_permission' });
        return;
      }

      api.permissions.request({ origins: [originPattern] }, (granted) => {
        if (!granted) {
          resolve({ granted: false, reason: 'user_denied' });
          return;
        }

        api.permissions.contains({ origins: [originPattern] }, (verified) => {
          resolve({
            granted: !!verified,
            reason: verified ? '' : 'not_granted_after_request',
          });
        });
      });
    });
  });
}

function loadStoredTableColWidths() {
  try {
    const raw = sessionStorage.getItem('v2TableColWidths');
    if (!raw) return { ...DEFAULT_TABLE_COL_WIDTHS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_TABLE_COL_WIDTHS };
    return {
      type: Math.max(MIN_TABLE_COL_WIDTH, Number(parsed.type) || DEFAULT_TABLE_COL_WIDTHS.type),
      name: Math.max(MIN_TABLE_COL_WIDTH, Number(parsed.name) || DEFAULT_TABLE_COL_WIDTHS.name),
      space: Math.max(MIN_TABLE_COL_WIDTH, Number(parsed.space) || DEFAULT_TABLE_COL_WIDTHS.space),
      contributor: Math.max(MIN_TABLE_COL_WIDTH, Number(parsed.contributor) || DEFAULT_TABLE_COL_WIDTHS.contributor),
      created: Math.max(MIN_TABLE_COL_WIDTH, Number(parsed.created) || DEFAULT_TABLE_COL_WIDTHS.created),
      modified: Math.max(MIN_TABLE_COL_WIDTH, Number(parsed.modified) || DEFAULT_TABLE_COL_WIDTHS.modified),
      ai: Math.max(MIN_TABLE_COL_WIDTH, Number(parsed.ai) || DEFAULT_TABLE_COL_WIDTHS.ai),
    };
  } catch {
    return { ...DEFAULT_TABLE_COL_WIDTHS };
  }
}

function loadStoredAiQuestionHeight() {
  const saved = Number.parseInt(sessionStorage.getItem('aiQuestionInputHeight') || '', 10);
  if (!Number.isFinite(saved)) return DEFAULT_AI_QUESTION_HEIGHT;
  return Math.max(MIN_AI_QUESTION_HEIGHT, Math.min(MAX_AI_QUESTION_HEIGHT, saved));
}

async function withTimeout(promise, timeoutMs, errorMessage) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function isContentModalModeRuntime() {
  try {
    return new URLSearchParams(window.location.search).get('mode') === 'content-modal';
  } catch {
    return false;
  }
}

function fetchViaHostBridge(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (window.parent === window) {
      reject(new Error('Host bridge unavailable'));
      return;
    }

    const requestId = `bridge-${Date.now()}-${bridgeRequestCounter += 1}`;
    let timeoutId = null;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener('message', onMessage);
    };

    const onMessage = (event) => {
      if (event.source !== window.parent) return;
      const payload = event.data || {};
      if (payload.type !== 'enhanced-ai-modal-fetch-result') return;
      if (payload.requestId !== requestId) return;
      cleanup();
      resolve(payload);
    };

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Host bridge timed out'));
    }, timeoutMs);

    window.addEventListener('message', onMessage);
    window.parent.postMessage({
      type: 'enhanced-ai-modal-fetch',
      requestId,
      url,
    }, '*');
  });
}

function fetchImageDataUrlViaHostBridge(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (window.parent === window) {
      reject(new Error('Host image bridge unavailable'));
      return;
    }

    const requestId = `bridge-img-${Date.now()}-${bridgeRequestCounter += 1}`;
    let timeoutId = null;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener('message', onMessage);
    };

    const onMessage = (event) => {
      if (event.source !== window.parent) return;
      const payload = event.data || {};
      if (payload.type !== 'enhanced-ai-modal-fetch-image-result') return;
      if (payload.requestId !== requestId) return;
      cleanup();
      if (!payload.ok || !payload.dataUrl) {
        reject(new Error(payload.error || 'Image bridge failed'));
        return;
      }
      resolve(payload.dataUrl);
    };

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Host image bridge timed out'));
    }, timeoutMs);

    window.addEventListener('message', onMessage);
    window.parent.postMessage({
      type: 'enhanced-ai-modal-fetch-image',
      requestId,
      url,
    }, '*');
  });
}

function sendOpenAIRequest({ apiKey, apiUrl, model, messages, reasoningEffort }) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: 'openaiPort' });
    const fullUrl = normalizeResponsesUrl(apiUrl);

    const cleanup = () => {
      port.onMessage.removeListener(handleMessage);
      port.onDisconnect.removeListener(handleDisconnect);
    };

    const handleMessage = (response) => {
      if (response?.keepAlive) return;
      cleanup();
      if (!response?.success) {
        reject(new Error(response?.error || 'Unknown error from background'));
        return;
      }
      const data = response.data || {};
      resolve({ ...data, output_text: data.output_text || extractOutputText(data) });
    };

    const handleDisconnect = () => {
      cleanup();
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      }
    };

    port.onMessage.addListener(handleMessage);
    port.onDisconnect.addListener(handleDisconnect);
    port.postMessage({ apiKey, apiUrl: fullUrl, model, messages, reasoningEffort });
  });
}

function sanitizeHtmlFragment(html = '') {
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((el) => el.remove());
  doc.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const n = attr.name.toLowerCase();
      const v = attr.value || '';
      if (n.startsWith('on')) el.removeAttribute(attr.name);
      if ((n === 'href' || n === 'src' || n === 'xlink:href') && /^\s*javascript:/i.test(v)) {
        el.removeAttribute(attr.name);
      }
    });
  });
  return doc.body.innerHTML;
}

function buildConfluenceBaseCandidates(baseUrl) {
  const candidates = [];
  const seen = new Set();
  const push = (url) => {
    const normalized = String(url || '').replace(/\/+$/, '');
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  try {
    const parsed = new URL(baseUrl || window.location.origin);
    const origin = parsed.origin.replace(/\/+$/, '');
    const path = parsed.pathname.replace(/\/+$/, '');
    if (path && path !== '/') push(`${origin}${path}`);
    push(`${origin}/wiki`);
    push(origin);
  } catch {
    const origin = window.location.origin.replace(/\/+$/, '');
    push(baseUrl);
    push(`${origin}/wiki`);
    push(origin);
  }

  return candidates;
}

async function fetchConfluenceJsonWithFallback(baseUrl, restPath) {
  const candidates = buildConfluenceBaseCandidates(baseUrl);
  let lastStatus = 0;
  let lastStatusText = 'Unknown';
  const errors = [];
  const useBridge = isContentModalModeRuntime();

  for (const candidate of candidates) {
    const url = `${candidate}${restPath}`;

    const attemptParsers = async (result, label) => {
      if (!result.ok) {
        lastStatus = Number(result.status) || 0;
        lastStatusText = result.statusText || 'Unknown';
        errors.push(`${candidate} [${label}]: HTTP ${lastStatus} ${lastStatusText}`);
        return null;
      }

      const contentType = (result.contentType || '').toLowerCase();
      const rawText = String(result.body || '');
      const trimmed = rawText.trim().replace(/^\uFEFF/, '').replace(/^\)\]\}',?\s*/, '');
      const likelyJson = contentType.includes('application/json')
        || trimmed.startsWith('{')
        || trimmed.startsWith('[');

      if (!likelyJson) {
        errors.push(`${candidate} [${label}]: non-JSON response (${contentType || 'unknown content-type'})`);
        return null;
      }

      try {
        const data = JSON.parse(trimmed);
        return { data, resolvedBaseUrl: candidate };
      } catch (parseErr) {
        errors.push(`${candidate} [${label}]: JSON parse failed (${parseErr.message})`);
        return null;
      }
    };

    if (useBridge) {
      try {
        const bridged = await fetchViaHostBridge(url);
        const parsed = await attemptParsers({
          ok: !!bridged.ok,
          status: bridged.status,
          statusText: bridged.statusText,
          body: bridged.body,
          contentType: bridged.contentType,
        }, 'bridge');
        if (parsed) return parsed;
      } catch (bridgeErr) {
        errors.push(`${candidate} [bridge]: ${bridgeErr.message}`);
      }
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'include',
    });

    const parsed = await attemptParsers({
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: await response.text(),
      contentType: response.headers.get('content-type') || '',
    }, 'direct');
    if (parsed) return parsed;
  }

  const details = errors.length ? ` Tried: ${errors.join(' | ')}` : '';
  throw new Error(`${lastStatus} ${lastStatusText}.${details}`);
}

async function fetchConfluenceBodyById(baseUrl, contentId, force = false) {
  if (confluenceBodyCache.has(contentId) && !force) return confluenceBodyCache.get(contentId);
  const { data } = await fetchConfluenceJsonWithFallback(
    baseUrl,
    `/rest/api/content/${contentId}?expand=body.storage`,
  );
  const bodyHtml = sanitizeHtmlFragment(data.body?.storage?.value || '(No content)');
  confluenceBodyCache.set(contentId, bodyHtml);
  return bodyHtml;
}

async function fetchConfluenceMetadataById(baseUrl, contentId) {
  const { data } = await fetchConfluenceJsonWithFallback(
    baseUrl,
    `/rest/api/content/${contentId}?expand=space.icon,history.createdBy,version,ancestors`,
  );
  return data;
}

async function fetchSpaceDetailsByKey(baseUrl, spaceKey) {
  if (!spaceKey) return null;
  try {
    const { data } = await fetchConfluenceJsonWithFallback(
      baseUrl,
      `/rest/api/space/${encodeURIComponent(spaceKey)}?expand=icon`,
    );
    return data || null;
  } catch {
    return null;
  }
}

async function fetchUserDetails(baseUrl, createdBy) {
  if (!createdBy || typeof createdBy !== 'object') return null;
  const accountId = createdBy.accountId || '';
  const username = createdBy.username || '';
  const userKey = createdBy.userKey || '';

  const queries = [
    accountId ? `accountId=${encodeURIComponent(accountId)}` : '',
    username ? `username=${encodeURIComponent(username)}` : '',
    userKey ? `key=${encodeURIComponent(userKey)}` : '',
  ].filter(Boolean);

  for (const query of queries) {
    try {
      const { data } = await fetchConfluenceJsonWithFallback(
        baseUrl,
        `/rest/api/user?${query}`,
      );
      if (data && typeof data === 'object') return data;
    } catch {
      // Try next query form
    }
  }

  return null;
}

async function enrichVisualMetadata(baseUrl, pageData) {
  const next = {
    ...(pageData || {}),
    space: { ...(pageData?.space || {}) },
    history: {
      ...(pageData?.history || {}),
      createdBy: { ...(pageData?.history?.createdBy || {}) },
    },
  };

  if (!next.space?.icon?.path && next.space?.key) {
    const spaceDetails = await fetchSpaceDetailsByKey(baseUrl, next.space.key);
    if (spaceDetails?.icon?.path) {
      next.space.icon = { ...(next.space.icon || {}), path: spaceDetails.icon.path };
    }
  }

  if (!next.history?.createdBy?.profilePicture?.path) {
    const userDetails = await fetchUserDetails(baseUrl, next.history?.createdBy || {});
    if (userDetails?.profilePicture?.path) {
      next.history.createdBy.profilePicture = {
        ...(next.history.createdBy.profilePicture || {}),
        path: userDetails.profilePicture.path,
      };
    }
    if (!next.history.createdBy.displayName && userDetails?.displayName) {
      next.history.createdBy.displayName = userDetails.displayName;
    }
  }

  return next;
}

function dedupeByKey(list, key) {
  const out = [];
  const seen = new Set();
  list.forEach((item) => {
    const k = item?.[key];
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(item);
  });
  return out;
}

async function searchSpacesByQuery(baseUrl, query, limit = 10) {
  const q = (query || '').trim();
  if (!q || q.length < 2) return [];
  const escaped = q.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  try {
    const cqlUrl = `${baseUrl}/rest/api/search?cql=${encodeURIComponent(`type=space AND title ~ "${escaped}*"`)}&limit=${limit}&expand=space.icon`;
    const res = await fetch(cqlUrl, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      const results = (data.results || []).map((s) => {
        const key = s.space?.key || s.key || '';
        const name = s.space?.name || s.name || '';
        const iconPath = s.space?.icon?.path || s.icon?.path || '';
        return {
          key,
          name,
          iconUrl: iconPath ? `${baseUrl}${iconPath}` : `${baseUrl}/images/logo/default-space-logo.svg`,
        };
      }).filter((s) => s.key && s.name);
      if (results.length > 0) return dedupeByKey(results, 'key');
    }
  } catch {
    // fall through to broad space listing fallback
  }

  try {
    const fallbackUrl = `${baseUrl}/rest/api/space?limit=${Math.max(25, limit * 3)}&expand=icon`;
    const res = await fetch(fallbackUrl, { credentials: 'include' });
    if (!res.ok) return [];
    const data = await res.json();
    const list = Array.isArray(data.results) ? data.results : [];
    const lowered = q.toLowerCase();
    const filtered = list.filter((s) => {
      const key = (s?.key || '').toLowerCase();
      const name = (s?.name || '').toLowerCase();
      return key.includes(lowered) || name.includes(lowered);
    }).map((s) => {
      const iconPath = s.icon?.path || '';
      return {
        key: s.key || '',
        name: s.name || '',
        iconUrl: iconPath ? `${baseUrl}${iconPath}` : `${baseUrl}/images/logo/default-space-logo.svg`,
      };
    }).filter((s) => s.key && s.name);
    return dedupeByKey(filtered, 'key').slice(0, limit);
  } catch {
    return [];
  }
}

async function searchUsersByQuery(baseUrl, query, limit = 10) {
  const q = (query || '').trim();
  if (!q || q.length < 2) return [];
  const escaped = q.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const cql = `type=user AND user ~ "${escaped}*"`;
  try {
    const cqlUrl = `${baseUrl}/rest/api/search?cql=${encodeURIComponent(cql)}&limit=${limit}&expand=icon`;
    const res = await fetch(cqlUrl, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      const results = (data.results || []).map((s) => {
        const u = s.user || {};
        const key = u.username || u.userKey || u.accountId || '';
        const displayName = u.displayName || key;
        const iconPath = u.profilePicture?.path || '';
        return {
          key,
          name: displayName,
          avatarUrl: iconPath
            ? (iconPath.startsWith('http') ? iconPath : `${baseUrl}${iconPath}`)
            : `${baseUrl}/images/icons/profilepics/default.png`,
        };
      }).filter((u) => u.key && u.name);
      if (results.length > 0) return dedupeByKey(results, 'key');
    }
  } catch {
    // fall through to user-search fallback
  }

  try {
    const fallbackUrl = `${baseUrl}/rest/api/user/search?username=${encodeURIComponent(q)}&limit=${limit}`;
    const res = await fetch(fallbackUrl, { credentials: 'include' });
    if (!res.ok) return [];
    const data = await res.json();
    const list = Array.isArray(data) ? data : [];
    const results = list.map((u) => {
      const key = u.username || u.userKey || u.accountId || '';
      const displayName = u.displayName || key;
      const iconPath = u.profilePicture?.path || '';
      return {
        key,
        name: displayName,
        avatarUrl: iconPath
          ? (iconPath.startsWith('http') ? iconPath : `${baseUrl}${iconPath}`)
          : `${baseUrl}/images/icons/profilepics/default.png`,
      };
    }).filter((u) => u.key && u.name);
    return dedupeByKey(results, 'key');
  } catch {
    return [];
  }
}

function buildConfluenceUrl(baseUrl, webui) {
  if (!webui) return '#';
  if (/^https?:\/\//i.test(webui)) return webui;
  return new URL(webui, baseUrl).toString();
}

function cqlFromState(searchText, filterType, filterDate, filterSpaceKey, filterContributorKey) {
  const escaped = searchText.replace(/(["\\])/g, '\\$1');
  const parts = [`(text ~ "${escaped}" OR title ~ "${escaped}")`];

  if (filterSpaceKey) parts.push(`space="${filterSpaceKey}"`);
  if (filterContributorKey) parts.push(`creator="${filterContributorKey}"`);
  if (filterType) parts.push(`type="${filterType}"`);

  if (['1d', '1w', '1m', '1y'].includes(filterDate)) {
    const date = new Date();
    if (filterDate === '1d') date.setDate(date.getDate() - 1);
    if (filterDate === '1w') date.setDate(date.getDate() - 7);
    if (filterDate === '1m') date.setMonth(date.getMonth() - 1);
    if (filterDate === '1y') date.setFullYear(date.getFullYear() - 1);
    parts.push(`lastModified >= "${date.toISOString().split('T')[0]}"`);
  }

  return encodeURIComponent(parts.join(' AND '));
}

function buildTree(results, baseUrl) {
  const nodeMap = new Map();
  const roots = [];

  const ensure = (id, value) => {
    if (!nodeMap.has(id)) {
      nodeMap.set(id, value);
    } else {
      const existing = nodeMap.get(id);
      if (!existing.sourceItem && value.sourceItem) existing.sourceItem = value.sourceItem;
      if ((!existing.url || existing.url === '#') && value.url) existing.url = value.url;
    }
    return nodeMap.get(id);
  };

  results.forEach((item) => {
    (item.ancestors || []).forEach((ancestor, idx, arr) => {
      ensure(ancestor.id, {
        id: ancestor.id,
        title: ancestor.title,
        url: buildConfluenceUrl(baseUrl, ancestor._links?.webui),
        isResult: false,
        type: 'page',
        sourceItem: {
          id: ancestor.id,
          title: ancestor.title,
          type: 'page',
          _links: ancestor._links || {},
          space: item.space || {},
          history: {},
          version: {},
          ancestors: arr.slice(0, idx),
        },
        children: [],
      });
    });

    ensure(item.id, {
      id: item.id,
      title: item.title,
      url: buildConfluenceUrl(baseUrl, item._links?.webui),
      isResult: true,
      type: item.type || 'page',
      sourceItem: item,
      children: [],
    });
  });

  results.forEach((item) => {
    const pageNode = nodeMap.get(item.id);
    if (!pageNode) return;

    const ancestors = item.ancestors || [];
    if (ancestors.length === 0) {
      if (!roots.some((r) => r.id === pageNode.id)) roots.push(pageNode);
      return;
    }

    let parent = null;
    ancestors.forEach((ancestor) => {
      const node = nodeMap.get(ancestor.id);
      if (!node) return;
      if (parent && !parent.children.some((c) => c.id === node.id)) parent.children.push(node);
      parent = node;
    });

    if (parent && !parent.children.some((c) => c.id === pageNode.id)) {
      parent.children.push(pageNode);
    }

    const root = nodeMap.get(ancestors[0].id);
    if (root && !roots.some((r) => r.id === root.id)) roots.push(root);
  });

  return roots;
}

function collectExpandableNodeIds(nodes) {
  const ids = [];
  const walk = (list) => {
    list.forEach((node) => {
      if (!Array.isArray(node?.children) || node.children.length === 0) return;
      ids.push(node.id);
      walk(node.children);
    });
  };
  walk(nodes);
  return ids;
}

function TreeNode({
  node,
  collapsed,
  onToggle,
  highlightResultRows,
  showTreeTooltips,
  onShowTooltip,
  onMoveTooltip,
  onHideTooltip,
  canSummarize,
  aiLoadingItemId,
  aiSummaryStatusById,
  onSummarize,
}) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.id);
  const aiStatus = aiLoadingItemId === node.id ? 'loading' : (aiSummaryStatusById[node.id] || 'idle');
  const aiLabel = aiStatus === 'loading'
    ? 'Thinking...'
    : aiStatus === 'ready'
      ? 'Open'
      : 'Summarize';

  return (
    <li class="tree-item">
      <div
        class={`tree-row ${(node.isResult && highlightResultRows) ? 'tree-row-result' : 'tree-row-parent'}`}
        onMouseEnter={(e) => {
          if (showTreeTooltips) onShowTooltip?.(e, node);
        }}
        onMouseMove={(e) => {
          if (showTreeTooltips) onMoveTooltip?.(e, node);
        }}
        onMouseLeave={() => {
          if (showTreeTooltips) onHideTooltip?.();
        }}
      >
        {hasChildren ? (
          <button class="toggle" onClick={() => onToggle(node.id)} title="Toggle">
            {isCollapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span class="toggle" />
        )}
        <span class="node-kind">{typeIcons[node.type] || '📄'}</span>
        <a class="node-link" href={node.url} target="_blank" rel="noreferrer" title={node.title}>
          {node.title}
        </a>
        {canSummarize && node.sourceItem && (
          <button
            class="mini-ai-btn"
            onClick={() => onSummarize(node.sourceItem)}
            disabled={aiStatus === 'loading'}
            title="AI Summary"
            data-status={aiStatus}
          >
            {aiLabel}
          </button>
        )}
      </div>

      {hasChildren && !isCollapsed && (
        <ul class="tree-list">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              collapsed={collapsed}
              onToggle={onToggle}
              highlightResultRows={highlightResultRows}
              showTreeTooltips={showTreeTooltips}
              onShowTooltip={onShowTooltip}
              onMoveTooltip={onMoveTooltip}
              onHideTooltip={onHideTooltip}
              canSummarize={canSummarize}
              aiLoadingItemId={aiLoadingItemId}
              aiSummaryStatusById={aiSummaryStatusById}
              onSummarize={onSummarize}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function App() {
  const params = getQueryParams();
  const modalOnlyMode = params.mode === 'content-modal';
  const modalContentId = (params.contentId || '').trim();
  const modalContentTitle = (params.contentTitle || '').trim();
  const shouldFocusSearchFromQuery = String(params.focusSearch || '') === '1';
  const initialBase = (params.baseUrl || window.location.origin).trim();
  const initialText = (params.searchText || '').trim();
  const [initialSpaceKey, initialSpaceLabel] = (params.space || '').split(':');
  const [initialContributorKey, initialContributorLabel] = (params.contributor || '').split(':');

  const [baseUrl, setBaseUrl] = useState(initialBase);
  const [searchInput, setSearchInput] = useState(initialText);
  const [searchText, setSearchText] = useState(initialText);
  const [searchInputAttention, setSearchInputAttention] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [selectedAiModel, setSelectedAiModel] = useState(DEFAULT_AI_MODEL);
  const [domainName, setDomainName] = useState('Unknown');
  const [resultsPerRequest, setResultsPerRequest] = useState(75);

  const [view, setView] = useState('tree');
  const [loading, setLoading] = useState(false);
  const [initialSearchPending, setInitialSearchPending] = useState(!!initialText);
  const [allLoaded, setAllLoaded] = useState(false);
  const [start, setStart] = useState(0);
  const [totalSize, setTotalSize] = useState(null);
  const [allResults, setAllResults] = useState([]);

  const [filterText, setFilterText] = useState((params.text || '').trim());
  const [filterSpace, setFilterSpace] = useState(initialSpaceKey || '');
  const [spaceInput, setSpaceInput] = useState(initialSpaceLabel || initialSpaceKey || '');
  const [selectedSpaceIcon, setSelectedSpaceIcon] = useState('');
  const [spaceSuggestions, setSpaceSuggestions] = useState([]);
  const [spaceDropdownOpen, setSpaceDropdownOpen] = useState(false);
  const [spaceActiveIndex, setSpaceActiveIndex] = useState(-1);
  const [spaceLookupLoading, setSpaceLookupLoading] = useState(false);
  const [filterContributor, setFilterContributor] = useState(initialContributorKey || '');
  const [contributorInput, setContributorInput] = useState(initialContributorLabel || initialContributorKey || '');
  const [selectedContributorIcon, setSelectedContributorIcon] = useState('');
  const [contributorSuggestions, setContributorSuggestions] = useState([]);
  const [contributorDropdownOpen, setContributorDropdownOpen] = useState(false);
  const [contributorActiveIndex, setContributorActiveIndex] = useState(-1);
  const [contributorLookupLoading, setContributorLookupLoading] = useState(false);
  const [filterDate, setFilterDate] = useState(params.date || 'any');
  const [filterType, setFilterType] = useState(params.type || '');

  const [collapsedNodes, setCollapsedNodes] = useState(() => new Set());
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [savedSearches, setSavedSearches] = useState([]);
  const [savedSearchVisualsById, setSavedSearchVisualsById] = useState({});
  const [savedSearchQuery, setSavedSearchQuery] = useState('');
  const [savedModalOpen, setSavedModalOpen] = useState(false);
  const [saveNameDialog, setSaveNameDialog] = useState({
    open: false,
    title: '',
    confirmLabel: 'Save',
    value: '',
    placeholder: 'Enter a name',
  });
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    danger: false,
  });
  const [noticeDialog, setNoticeDialog] = useState({
    open: false,
    title: '',
    message: '',
    tone: 'info',
  });
  const [enableSummaries, setEnableSummaries] = useState(true);
  const [highlightResultRows, setHighlightResultRows] = useState(true);
  const [showTreeTooltips, setShowTreeTooltips] = useState(true);
  const [showTableTooltips, setShowTableTooltips] = useState(true);
  const [treeTooltipData, setTreeTooltipData] = useState(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiModalLoading, setAiModalLoading] = useState(false);
  const [aiItemLoadingId, setAiItemLoadingId] = useState(null);
  const [aiActiveItem, setAiActiveItem] = useState(null);
  const [aiSummaryHtml, setAiSummaryHtml] = useState('');
  const [aiUserPrompt, setAiUserPrompt] = useState('');
  const [aiConversation, setAiConversation] = useState([]);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswerLoading, setAiAnswerLoading] = useState(false);
  const [aiSummaryRefreshing, setAiSummaryRefreshing] = useState(false);
  const [aiSummaryStatusById, setAiSummaryStatusById] = useState({});
  const [aiSummaryCheckedById, setAiSummaryCheckedById] = useState({});
  const [aiSummaryPaneRatio, setAiSummaryPaneRatio] = useState(() => {
    const saved = Number.parseFloat(sessionStorage.getItem('aiSummaryPaneRatio') || '');
    if (!Number.isFinite(saved)) return DEFAULT_AI_SUMMARY_PANE_RATIO;
    return Math.max(MIN_AI_SUMMARY_PANE_RATIO, Math.min(MAX_AI_SUMMARY_PANE_RATIO, saved));
  });
  const [isAiSummaryCollapsed, setIsAiSummaryCollapsed] = useState(false);
  const [isAiChatCollapsed, setIsAiChatCollapsed] = useState(false);
  const [aiModalWidth, setAiModalWidth] = useState(() => {
    const saved = Number.parseInt(sessionStorage.getItem('aiModalWidth') || '', 10);
    if (!Number.isFinite(saved)) return DEFAULT_AI_MODAL_WIDTH;
    return Math.max(MIN_AI_MODAL_WIDTH, saved);
  });
  const [aiModalHeight, setAiModalHeight] = useState(() => {
    const saved = Number.parseInt(sessionStorage.getItem('aiModalHeight') || '', 10);
    if (!Number.isFinite(saved)) return DEFAULT_AI_MODAL_HEIGHT;
    return Math.max(MIN_AI_MODAL_HEIGHT, saved);
  });
  const [aiQuestionInputHeight, setAiQuestionInputHeight] = useState(() => loadStoredAiQuestionHeight());
  const [tableColWidths, setTableColWidths] = useState(() => loadStoredTableColWidths());
  const [aiSpaceIconSrc, setAiSpaceIconSrc] = useState(fallbackSpaceIcon);
  const [aiContributorIconSrc, setAiContributorIconSrc] = useState(fallbackUserIcon);

  const scrollerRef = useRef(null);
  const inflightRef = useRef(false);
  const aiThreadRef = useRef(null);
  const aiModalRef = useRef(null);
  const aiLayoutRef = useRef(null);
  const treeTooltipRef = useRef(null);
  const treeTooltipPointerRef = useRef({ x: 0, y: 0 });
  const spaceReqIdRef = useRef(0);
  const contributorReqIdRef = useRef(0);
  const spaceBoxRef = useRef(null);
  const contributorBoxRef = useRef(null);
  const saveNameDialogResolverRef = useRef(null);
  const saveNameDialogInputRef = useRef(null);
  const confirmDialogResolverRef = useRef(null);
  const aiQuestionInputRef = useRef(null);
  const modalOnlyInitializedRef = useRef(false);
  const searchInputRef = useRef(null);
  const didAutoFocusSearchRef = useRef(false);

  const resetLoadedData = () => {
    setAllResults([]);
    setCollapsedNodes(new Set());
    setAllLoaded(false);
    setStart(0);
    setTotalSize(null);
  };

  const ensureUniqueName = (candidate, list, currentId = null) => {
    const normalized = candidate.trim();
    const base = normalized || 'Saved Search';
    const existing = new Set(list.filter((entry) => entry.id !== currentId).map((entry) => entry.name));
    if (!existing.has(base)) return base;
    let i = 1;
    let next = `${base} (${i})`;
    while (existing.has(next)) {
      i += 1;
      next = `${base} (${i})`;
    }
    return next;
  };

  const buildDefaultSavedName = () => {
    const date = new Date();
    return ensureUniqueName(
      `Search on ${date.toLocaleDateString()} at ${date.toLocaleTimeString()}`,
      savedSearches,
    );
  };

  const loadSavedSearches = async () => {
    try {
      const list = await getAllSavedSearches();
      setSavedSearches(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('[V2 Preact] Failed to load saved searches:', err);
      openNoticeDialog({
        title: 'Failed to Load Saved Searches',
        message: err.message || 'Unknown error',
        tone: 'error',
      });
    }
  };

  const createBaseConversation = (userPromptText, summaryHtml) => ([
    { role: 'system', content: qaSystemPrompt },
    { role: 'user', content: userPromptText },
    { role: 'assistant', content: summaryHtml },
  ]);

  const openConfirmDialog = ({
    title,
    message,
    confirmLabel = 'Confirm',
    danger = false,
  }) => new Promise((resolve) => {
    confirmDialogResolverRef.current = resolve;
    setConfirmDialog({
      open: true,
      title,
      message,
      confirmLabel,
      danger,
    });
  });

  const closeConfirmDialog = (value = false) => {
    const resolver = confirmDialogResolverRef.current;
    confirmDialogResolverRef.current = null;
    setConfirmDialog((prev) => ({ ...prev, open: false }));
    if (typeof resolver === 'function') resolver(Boolean(value));
  };

  const openNoticeDialog = ({
    title = 'Notice',
    message = '',
    tone = 'info',
  }) => {
    setNoticeDialog({
      open: true,
      title,
      message,
      tone: ['info', 'success', 'error'].includes(tone) ? tone : 'info',
    });
  };

  const closeNoticeDialog = () => {
    setNoticeDialog((prev) => ({ ...prev, open: false }));
  };

  const getAiRuntimeSettings = async ({ requireApiKey = false, requestEndpointPermission = true } = {}) => {
    const syncData = await new Promise((resolve) => {
      chrome.storage.sync.get(
        ['openaiApiKey', 'customApiEndpoint', 'selectedAiModel', 'reasoningEffort', 'useHighReasoningEffort'],
        resolve,
      );
    });

    const settings = {
      apiKey: syncData.openaiApiKey || '',
      apiUrl: syncData.customApiEndpoint?.trim() || 'https://api.openai.com/v1',
      model: syncData.selectedAiModel || DEFAULT_AI_MODEL,
      reasoningEffort: resolveReasoningEffort(syncData.reasoningEffort, syncData.useHighReasoningEffort),
    };

    if (requireApiKey && !settings.apiKey) {
      throw new Error('An OpenAI API key is required. Configure it in extension options.');
    }

    let endpointOrigin = '';
    try {
      endpointOrigin = new URL(normalizeResponsesUrl(settings.apiUrl)).origin;
    } catch {
      throw new Error('Invalid OpenAI API endpoint URL. Check extension options.');
    }

    const permissionResult = await ensureApiOriginPermission(endpointOrigin, { requestIfMissing: requestEndpointPermission });
    if (!permissionResult.granted) {
      if (permissionResult.reason === 'missing_permission') {
        throw new Error('OpenAI endpoint permission is missing. Re-open summary from the Confluence page and allow the permission prompt.');
      }
      throw new Error('Permission denied for the OpenAI endpoint domain. Please allow it and try again.');
    }

    return settings;
  };

  const buildUserPrompt = async (pageData, forceBodyFetch = false) => {
    const bodyHtml = await fetchConfluenceBodyById(baseUrl, pageData.id, forceBodyFetch);
    const localData = await new Promise((resolve) => {
      chrome.storage.local.get(['customUserPrompt'], resolve);
    });
    const customPrompt = (localData.customUserPrompt || '').trim();
    const pageUrl = buildConfluenceUrl(baseUrl, pageData._links?.webui);
    const parentTitles = (Array.isArray(pageData.ancestors) ? pageData.ancestors : [])
      .map((ancestor) => ancestor?.title)
      .filter(Boolean);
    const parentPath = parentTitles.length ? parentTitles.join(' > ') : 'N/A';
    const directParent = parentTitles.length ? parentTitles[parentTitles.length - 1] : 'N/A';
    const details = `
--- Content Details ---
Title: ${pageData.title || 'Untitled'}
Contributor: ${pageData.history?.createdBy?.displayName || 'Unknown'}
Created: ${pageData.history?.createdDate || 'N/A'}
Modified: ${formatDate(pageData.version?.when)}
Type: ${pageData.type || 'page'}
Space: ${pageData.space?.name || 'N/A'}
Direct Parent: ${directParent}
Parent Path: ${parentPath}
URL: ${pageUrl}
Content (HTML): ${bodyHtml}
    `.trim();
    return customPrompt ? `${customPrompt}\n\n${details}` : details;
  };

  const collectSummaryCandidateIds = (items) => {
    const ids = new Set();
    items.forEach((item) => {
      if (!item?.id) return;
      ids.add(item.id);
      const ancestors = Array.isArray(item.ancestors) ? item.ancestors : [];
      ancestors.forEach((ancestor) => {
        if (ancestor?.id) ids.add(ancestor.id);
      });
    });
    return [...ids];
  };

  const openAiSummaryModal = async (pageData, { forceResummarize = false } = {}) => {
    if (!pageData?.id) return;
    if (!enableSummaries) {
      openNoticeDialog({
        title: 'AI Summaries Disabled',
        message: 'Enable AI summaries in the extension options.',
        tone: 'info',
      });
      return;
    }

    const contentId = pageData.id;
    const preflightStoredSummary = !forceResummarize
      ? await getStoredSummary(contentId, baseUrl)
      : null;

    if (!preflightStoredSummary?.summaryHtml) {
      try {
        await getAiRuntimeSettings({ requireApiKey: true, requestEndpointPermission: !modalOnlyMode });
      } catch (err) {
        const message = err?.message || 'Unknown error';
        const isApiKeyIssue = /api key/i.test(message);
        openNoticeDialog({
          title: isApiKeyIssue ? 'OpenAI API Key Missing' : 'AI Setup Required',
          message: isApiKeyIssue
            ? 'Please set your OpenAI API key in the extension Options page first.'
            : message,
          tone: 'error',
        });
        return;
      }
    }

    setAiItemLoadingId(contentId);
    setAiSummaryStatusById((prev) => ({ ...prev, [contentId]: 'loading' }));
    const useBlockingLoader = !(forceResummarize && aiModalOpen);
    if (useBlockingLoader) setAiModalLoading(true);
    setAiActiveItem({
      ...pageData,
      ancestors: Array.isArray(pageData.ancestors) ? pageData.ancestors : [],
    });
    if (!aiModalOpen) setAiModalOpen(true);

    try {
      let resolvedPageData = pageData;
      try {
        const metadata = await fetchConfluenceMetadataById(baseUrl, contentId);
        resolvedPageData = {
          ...pageData,
          ...metadata,
          space: { ...(pageData.space || {}), ...(metadata.space || {}) },
          history: {
            ...(pageData.history || {}),
            ...(metadata.history || {}),
            createdBy: {
              ...(pageData.history?.createdBy || {}),
              ...(metadata.history?.createdBy || {}),
            },
          },
          _links: { ...(pageData._links || {}), ...(metadata._links || {}) },
        };
      } catch (metaErr) {
        console.warn('[V2 Preact] Metadata fetch failed, using existing page data:', metaErr);
      }

      resolvedPageData = await enrichVisualMetadata(baseUrl, resolvedPageData);

      let summaryHtml = '';
      let userPromptText = '';
      let conversation = null;

      const storedSummary = !forceResummarize
        ? preflightStoredSummary
        : null;

      if (storedSummary?.summaryHtml) {
        summaryHtml = sanitizeHtmlFragment(storedSummary.summaryHtml);
        userPromptText = storedSummary.userPrompt || '';
      } else {
        const {
          apiKey, apiUrl, model, reasoningEffort,
        } = await getAiRuntimeSettings({ requireApiKey: true, requestEndpointPermission: !modalOnlyMode });
        userPromptText = await buildUserPrompt(resolvedPageData, forceResummarize);
        const result = await withTimeout(
          sendOpenAIRequest({
            apiKey,
            apiUrl,
            model,
            reasoningEffort,
            messages: [
              { role: 'system', content: summarySystemPrompt },
              { role: 'user', content: userPromptText },
            ],
          }),
          OPENAI_REQUEST_TIMEOUT_MS,
          'Summary request timed out. Please try again.',
        );
        summaryHtml = sanitizeHtmlFragment(result.output_text || '[No response]');
        await storeSummary({
          contentId,
          baseUrl,
          title: resolvedPageData.title || pageData.title,
          summaryHtml,
          userPrompt: userPromptText,
          timestamp: Date.now(),
        });
      }

      if (!userPromptText) userPromptText = await buildUserPrompt(resolvedPageData, false);

      const storedConversation = await getStoredConversation(contentId, baseUrl);
      if (Array.isArray(storedConversation?.messages) && !forceResummarize) {
        conversation = storedConversation.messages.map((msg) => (
          msg.role === 'assistant'
            ? { ...msg, content: sanitizeHtmlFragment(msg.content || '') }
            : msg
        ));
      } else {
        conversation = createBaseConversation(userPromptText, summaryHtml);
        await storeConversation(contentId, baseUrl, conversation);
      }

      setAiActiveItem(resolvedPageData);
      setAiSummaryHtml(summaryHtml);
      setAiUserPrompt(userPromptText);
      setAiConversation(conversation);
      setAiQuestion('');
      setAiSummaryStatusById((prev) => ({ ...prev, [contentId]: 'ready' }));
      setAiSummaryCheckedById((prev) => ({ ...prev, [contentId]: true }));
    } catch (err) {
      console.error('[V2 Preact] AI summary failed:', err);
      openNoticeDialog({
        title: 'Failed to Summarize Page',
        message: err.message || 'Unknown error',
        tone: 'error',
      });
      setAiSummaryStatusById((prev) => ({
        ...prev,
        [contentId]: prev[contentId] === 'ready' ? 'ready' : 'idle',
      }));
      setAiSummaryCheckedById((prev) => ({ ...prev, [contentId]: true }));
    } finally {
      setAiItemLoadingId(null);
      setAiModalLoading(false);
      setAiSummaryRefreshing(false);
    }
  };

  const submitAiQuestion = async () => {
    if (!aiActiveItem?.id || aiAnswerLoading) return;
    const question = aiQuestion.trim();
    if (!question) return;

    const withUser = [...aiConversation, { role: 'user', content: question }];
    setAiConversation(withUser);
    setAiQuestion('');
    setAiAnswerLoading(true);

    try {
      const {
        apiKey, apiUrl, model, reasoningEffort,
      } = await getAiRuntimeSettings({ requireApiKey: true, requestEndpointPermission: !modalOnlyMode });
      const result = await withTimeout(
        sendOpenAIRequest({
          apiKey,
          apiUrl,
          model,
          reasoningEffort,
          messages: withUser,
        }),
        OPENAI_REQUEST_TIMEOUT_MS,
        'Q&A request timed out. Please try again.',
      );
      const answer = sanitizeHtmlFragment(result.output_text || '[No response]');
      const nextConversation = [...withUser, { role: 'assistant', content: answer }];
      setAiConversation(nextConversation);
      await storeConversation(aiActiveItem.id, baseUrl, nextConversation);
    } catch (err) {
      console.error('[V2 Preact] AI Q&A failed:', err);
      openNoticeDialog({
        title: 'Failed to Get Answer',
        message: err.message || 'Unknown error',
        tone: 'error',
      });
    } finally {
      setAiAnswerLoading(false);
    }
  };

  const clearAiConversation = async () => {
    if (!aiActiveItem?.id) return;
    const confirmed = await openConfirmDialog({
      title: 'Clear conversation?',
      message: 'This will remove all follow-up messages but keep the summary.',
      confirmLabel: 'Clear',
      danger: true,
    });
    if (!confirmed) return;
    const resetConversation = createBaseConversation(aiUserPrompt, aiSummaryHtml);
    setAiConversation(resetConversation);
    try {
      await storeConversation(aiActiveItem.id, baseUrl, resetConversation);
    } catch (err) {
      console.error('[V2 Preact] Failed to clear conversation:', err);
      openNoticeDialog({
        title: 'Failed to Clear Conversation',
        message: err.message || 'Unknown error',
        tone: 'error',
      });
    }
  };

  const resummarizeActiveItem = async () => {
    if (!aiActiveItem) return;
    setAiModalLoading(false);
    setAiSummaryRefreshing(true);
    try {
      await openAiSummaryModal(aiActiveItem, { forceResummarize: true });
    } finally {
      setAiSummaryRefreshing(false);
    }
  };

  const closeAiModal = () => {
    setAiModalOpen(false);
    if (modalOnlyMode && window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'enhanced-ai-modal-close' }, '*');
    }
  };

  useEffect(() => {
    if (!modalOnlyMode || !modalContentId || modalOnlyInitializedRef.current) return;
    modalOnlyInitializedRef.current = true;

    (async () => {
      try {
        const pageData = {
          id: modalContentId,
          title: modalContentTitle || `Page ${modalContentId}`,
          type: 'page',
          _links: {},
          space: {},
          history: {},
          version: {},
          ancestors: [],
        };
        await openAiSummaryModal(pageData);
      } catch (err) {
        console.error('[V2 Preact] Failed to open content-page modal-only summary:', err);
        openNoticeDialog({
          title: 'Failed to Open AI Summary',
          message: err.message || 'Unknown error',
          tone: 'error',
        });
        closeAiModal();
      }
    })();
  }, [modalOnlyMode, modalContentId, modalContentTitle, baseUrl]);

  useEffect(() => {
    document.body.classList.toggle('modal-only-frame', modalOnlyMode);
    return () => document.body.classList.remove('modal-only-frame');
  }, [modalOnlyMode]);

  useEffect(() => {
    try {
      const host = new URL(baseUrl).hostname;
      setDomainName(host);
      document.title = searchText
        ? `Search: ${searchText} on ${host}`
        : `Enhanced Search on ${host}`;
    } catch {
      setDomainName('Unknown');
    }
  }, [baseUrl, searchText]);

  useEffect(() => {
    const loadSettings = async () => {
      const data = await new Promise((resolve) => {
        chrome.storage.sync.get(['darkMode', 'resultsPerRequest', 'enableSummaries', 'selectedAiModel', 'highlightResultRows', 'showTooltips', 'showTreeTooltips', 'showTableTooltips'], resolve);
      });
      const darkModeEnabled = !!data.darkMode;
      setIsDarkMode(darkModeEnabled);
      document.body.classList.toggle('dark-mode', darkModeEnabled);
      if (Number.isInteger(data.resultsPerRequest)) setResultsPerRequest(data.resultsPerRequest);
      setEnableSummaries(data.enableSummaries !== false);
      setHighlightResultRows(data.highlightResultRows !== false);
      const legacyTooltip = data.showTooltips;
      setShowTreeTooltips((data.showTreeTooltips ?? legacyTooltip) !== false);
      setShowTableTooltips((data.showTableTooltips ?? legacyTooltip) !== false);

      const requestedModel = retiredModelFallbacks[data.selectedAiModel] || data.selectedAiModel || DEFAULT_AI_MODEL;
      setSelectedAiModel(requestedModel);
      if (data.selectedAiModel && requestedModel !== data.selectedAiModel) {
        chrome.storage.sync.set({ selectedAiModel: requestedModel });
      }
    };

    loadSettings();

    const onStorage = (changes, area) => {
      if (area !== 'sync') return;
      if (changes.darkMode) {
        const nextDarkMode = !!changes.darkMode.newValue;
        setIsDarkMode(nextDarkMode);
        document.body.classList.toggle('dark-mode', nextDarkMode);
      }
      if (changes.resultsPerRequest && Number.isInteger(changes.resultsPerRequest.newValue)) {
        setResultsPerRequest(changes.resultsPerRequest.newValue);
      }
      if (changes.enableSummaries) setEnableSummaries(changes.enableSummaries.newValue !== false);
      if (changes.highlightResultRows) setHighlightResultRows(changes.highlightResultRows.newValue !== false);
      if (changes.showTooltips && !changes.showTreeTooltips) {
        setShowTreeTooltips(changes.showTooltips.newValue !== false);
      }
      if (changes.showTooltips && !changes.showTableTooltips) {
        setShowTableTooltips(changes.showTooltips.newValue !== false);
      }
      if (changes.showTreeTooltips) setShowTreeTooltips(changes.showTreeTooltips.newValue !== false);
      if (changes.showTableTooltips) setShowTableTooltips(changes.showTableTooltips.newValue !== false);
      if (changes.selectedAiModel) {
        const nextModel = retiredModelFallbacks[changes.selectedAiModel.newValue]
          || changes.selectedAiModel.newValue
          || DEFAULT_AI_MODEL;
        setSelectedAiModel(nextModel);
        if (nextModel !== changes.selectedAiModel.newValue) {
          chrome.storage.sync.set({ selectedAiModel: nextModel });
        }
      }
    };

    chrome.storage.onChanged.addListener(onStorage);
    return () => chrome.storage.onChanged.removeListener(onStorage);
  }, []);

  useEffect(() => {
    setAllResults([]);
    setCollapsedNodes(new Set());
    setAllLoaded(false);
    setStart(0);
    setTotalSize(null);
    setInitialSearchPending(!!searchText);
  }, [searchText, baseUrl, filterDate, filterType, filterSpace, filterContributor, resultsPerRequest]);

  useEffect(() => {
    loadSavedSearches();
  }, []);

  useEffect(() => {
    if (!savedModalOpen) return;
    const pending = savedSearches.filter((entry) => !savedSearchVisualsById[entry.id]);
    if (pending.length === 0) return;

    let alive = true;
    (async () => {
      const updates = await Promise.all(
        pending.map(async (entry) => {
          const base = (entry.baseUrl || baseUrl || '').replace(/\/+$/, '');
          const spaceKey = entry.filters?.space?.key || '';
          const spaceLabel = entry.filters?.space?.label || '';
          const contributorKey = entry.filters?.contributor?.key || '';
          const contributorLabel = entry.filters?.contributor?.label || '';
          let spaceIconUrl = fallbackSpaceIcon;
          let contributorIconUrl = fallbackUserIcon;

          if (base && spaceKey) {
            try {
              const sRes = await fetch(
                `${base}/rest/api/space/${encodeURIComponent(spaceKey)}?expand=icon`,
                { credentials: 'include' },
              );
              if (sRes.ok) {
                const sData = await sRes.json();
                spaceIconUrl = resolveConfluenceIconUrl(base, sData?.icon?.path, fallbackSpaceIcon);
              }
            } catch {
              // non-fatal, fallback icon is used
            }
          }

          if (spaceIconUrl === fallbackSpaceIcon && base && spaceLabel) {
            try {
              const escaped = spaceLabel.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
              const cql = `type=space AND title ~ "${escaped}*"`;
              const searchRes = await fetch(
                `${base}/rest/api/search?cql=${encodeURIComponent(cql)}&limit=1&expand=space.icon`,
                { credentials: 'include' },
              );
              if (searchRes.ok) {
                const searchData = await searchRes.json();
                const iconPath = searchData?.results?.[0]?.space?.icon?.path || '';
                spaceIconUrl = resolveConfluenceIconUrl(base, iconPath, fallbackSpaceIcon);
              }
            } catch {
              // non-fatal, fallback icon is used
            }
          }

          if (base && contributorKey) {
            const tryUrls = [
              `${base}/rest/api/user?accountId=${encodeURIComponent(contributorKey)}`,
              `${base}/rest/api/user?username=${encodeURIComponent(contributorKey)}`,
              `${base}/rest/api/user?key=${encodeURIComponent(contributorKey)}`,
            ];

            for (let idx = 0; idx < tryUrls.length; idx += 1) {
              try {
                const uRes = await fetch(tryUrls[idx], { credentials: 'include' });
                if (!uRes.ok) continue;
                const uData = await uRes.json();
                const path = uData?.profilePicture?.path || '';
                contributorIconUrl = resolveConfluenceIconUrl(base, path, fallbackUserIcon);
                if (path) break;
              } catch {
                // try next url
              }
            }
          }

          if (contributorIconUrl === fallbackUserIcon && base && contributorLabel) {
            try {
              const listRes = await fetch(
                `${base}/rest/api/user/search?username=${encodeURIComponent(contributorLabel)}&limit=1`,
                { credentials: 'include' },
              );
              if (listRes.ok) {
                const list = await listRes.json();
                const path = Array.isArray(list) ? list[0]?.profilePicture?.path : '';
                contributorIconUrl = resolveConfluenceIconUrl(base, path, fallbackUserIcon);
              }
            } catch {
              // non-fatal, fallback icon is used
            }
          }

          return { id: entry.id, spaceIconUrl, contributorIconUrl };
        }),
      );

      if (!alive) return;
      setSavedSearchVisualsById((prev) => {
        const next = { ...prev };
        updates.forEach((item) => {
          next[item.id] = {
            spaceIconUrl: item.spaceIconUrl,
            contributorIconUrl: item.contributorIconUrl,
          };
        });
        return next;
      });
    })();

    return () => {
      alive = false;
    };
  }, [savedModalOpen, savedSearches, savedSearchVisualsById, baseUrl]);

  useEffect(() => {
    if (!savedModalOpen) return undefined;
    const onEscape = (e) => {
      if (e.key === 'Escape') setSavedModalOpen(false);
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [savedModalOpen]);

  useEffect(() => {
    if (!saveNameDialog.open) return undefined;
    const onEscape = (e) => {
      if (e.key === 'Escape') closeSaveNameDialog(null);
    };
    document.addEventListener('keydown', onEscape);
    const handle = setTimeout(() => saveNameDialogInputRef.current?.focus(), 0);
    return () => {
      clearTimeout(handle);
      document.removeEventListener('keydown', onEscape);
    };
  }, [saveNameDialog.open]);

  useEffect(() => {
    if (!confirmDialog.open) return undefined;
    const onEscape = (e) => {
      if (e.key === 'Escape') closeConfirmDialog(false);
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [confirmDialog.open]);

  useEffect(() => {
    if (!noticeDialog.open) return undefined;
    const onEscape = (e) => {
      if (e.key === 'Escape') closeNoticeDialog();
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [noticeDialog.open]);

  useEffect(() => () => {
    if (saveNameDialogResolverRef.current) {
      saveNameDialogResolverRef.current(null);
      saveNameDialogResolverRef.current = null;
    }
    if (confirmDialogResolverRef.current) {
      confirmDialogResolverRef.current(false);
      confirmDialogResolverRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!aiModalOpen) return undefined;
    const onEscape = (e) => {
      if (e.key === 'Escape') closeAiModal();
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [aiModalOpen, closeAiModal]);

  useEffect(() => {
    if (!aiModalOpen) return;
    const thread = aiThreadRef.current;
    if (!thread) return;
    thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
  }, [aiConversation, aiAnswerLoading, aiModalOpen]);

  useEffect(() => {
    setAiSummaryStatusById({});
    setAiSummaryCheckedById({});
  }, [baseUrl]);

  useEffect(() => {
    if (!treeTooltipData) return;
    requestAnimationFrame(() => {
      positionTreeTooltip(treeTooltipPointerRef.current.x, treeTooltipPointerRef.current.y);
    });
  }, [treeTooltipData]);

  useEffect(() => {
    if (view !== 'tree') setTreeTooltipData(null);
  }, [view]);

  useEffect(() => {
    if (!showTreeTooltips) setTreeTooltipData(null);
  }, [showTreeTooltips]);

  useEffect(() => {
    const ids = collectSummaryCandidateIds(allResults);
    const unchecked = ids.filter((id) => !aiSummaryCheckedById[id] && aiItemLoadingId !== id);
    if (unchecked.length === 0) return;

    let alive = true;
    (async () => {
      const checks = await Promise.all(
        unchecked.map(async (id) => {
          try {
            const stored = await getStoredSummary(id, baseUrl);
            return { id, hasSummary: !!stored?.summaryHtml };
          } catch {
            return { id, hasSummary: false };
          }
        }),
      );
      if (!alive) return;

      setAiSummaryStatusById((prev) => {
        const next = { ...prev };
        checks.forEach(({ id, hasSummary }) => {
          if (next[id] === 'loading') return;
          next[id] = hasSummary ? 'ready' : (next[id] || 'idle');
        });
        return next;
      });

      setAiSummaryCheckedById((prev) => {
        const next = { ...prev };
        checks.forEach(({ id }) => {
          next[id] = true;
        });
        return next;
      });
    })();

    return () => {
      alive = false;
    };
  }, [allResults, aiSummaryCheckedById, aiItemLoadingId, baseUrl]);

  const filteredResults = useMemo(() => {
    const text = filterText.trim().toLowerCase();

    return allResults.filter((item) => {
      const title = (item.title || '').toLowerCase();
      const matchesText = !text || title.includes(text);
      const matchesSpace = !filterSpace || item.space?.key === filterSpace;
      const contributorKey = item.history?.createdBy?.username || item.history?.createdBy?.userKey || item.history?.createdBy?.accountId || '';
      const matchesContributor = !filterContributor || contributorKey === filterContributor;
      return matchesText && matchesSpace && matchesContributor;
    });
  }, [allResults, filterText, filterSpace, filterContributor]);

  const spaceOptions = useMemo(() => {
    const map = new Map();
    allResults.forEach((item) => {
      if (!item.space?.key || !item.space?.name) return;
      const iconPath = item.space?.icon?.path || '';
      const iconUrl = iconPath ? `${baseUrl}${iconPath}` : `${baseUrl}/images/logo/default-space-logo.svg`;
      map.set(item.space.key, { key: item.space.key, name: item.space.name, iconUrl });
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allResults, baseUrl]);

  const contributorOptions = useMemo(() => {
    const map = new Map();
    allResults.forEach((item) => {
      const c = item.history?.createdBy;
      const key = c?.username || c?.userKey || c?.accountId;
      if (!key) return;
      const avatarPath = c?.profilePicture?.path || '';
      const avatarUrl = avatarPath
        ? `${baseUrl}${avatarPath}`
        : `${baseUrl}/images/icons/profilepics/default.png`;
      map.set(key, { key, name: c?.displayName || key, avatarUrl });
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allResults, baseUrl]);

  useEffect(() => {
    if (!filterSpace) {
      setSelectedSpaceIcon('');
      return;
    }
    const localMatch = spaceOptions.find((space) => space.key === filterSpace);
    if (localMatch?.iconUrl) {
      setSelectedSpaceIcon(localMatch.iconUrl);
      return;
    }

    let alive = true;
    (async () => {
      try {
        const res = await fetch(
          `${baseUrl}/rest/api/space/${encodeURIComponent(filterSpace)}?expand=icon`,
          { credentials: 'include' },
        );
        if (!res.ok || !alive) return;
        const data = await res.json();
        const iconPath = data?.icon?.path || '';
        if (iconPath) {
          setSelectedSpaceIcon(resolveConfluenceIconUrl(baseUrl, iconPath, fallbackSpaceIcon));
        }
      } catch {
        // non-fatal
      }
    })();

    return () => {
      alive = false;
    };
  }, [filterSpace, spaceOptions, baseUrl]);

  useEffect(() => {
    if (!filterContributor) {
      setSelectedContributorIcon('');
      return;
    }
    const localMatch = contributorOptions.find((user) => user.key === filterContributor);
    if (localMatch?.avatarUrl) {
      setSelectedContributorIcon(localMatch.avatarUrl);
      return;
    }

    let alive = true;
    (async () => {
      const tryUrls = [
        `${baseUrl}/rest/api/user?accountId=${encodeURIComponent(filterContributor)}`,
        `${baseUrl}/rest/api/user?username=${encodeURIComponent(filterContributor)}`,
        `${baseUrl}/rest/api/user?key=${encodeURIComponent(filterContributor)}`,
      ];
      for (let idx = 0; idx < tryUrls.length; idx += 1) {
        try {
          const res = await fetch(tryUrls[idx], { credentials: 'include' });
          if (!res.ok || !alive) continue;
          const data = await res.json();
          const iconPath = data?.profilePicture?.path || '';
          if (!iconPath) continue;
          setSelectedContributorIcon(resolveConfluenceIconUrl(baseUrl, iconPath, fallbackUserIcon));
          return;
        } catch {
          // try next endpoint
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [filterContributor, contributorOptions, baseUrl]);

  useEffect(() => {
    const onDocMouseDown = (e) => {
      if (spaceBoxRef.current && !spaceBoxRef.current.contains(e.target)) {
        setSpaceDropdownOpen(false);
        setSpaceActiveIndex(-1);
      }
      if (contributorBoxRef.current && !contributorBoxRef.current.contains(e.target)) {
        setContributorDropdownOpen(false);
        setContributorActiveIndex(-1);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  useEffect(() => {
    const local = spaceOptions.filter((s) => {
      const q = spaceInput.trim().toLowerCase();
      return !q || s.name.toLowerCase().includes(q) || s.key.toLowerCase().includes(q);
    });
    setSpaceSuggestions(local.slice(0, 20));
    setSpaceActiveIndex(-1);
  }, [spaceInput, spaceOptions]);

  useEffect(() => {
    const term = spaceInput.trim();
    if (term.length < 2) {
      setSpaceLookupLoading(false);
      return undefined;
    }
    const reqId = ++spaceReqIdRef.current;
    const handle = setTimeout(async () => {
      try {
        setSpaceLookupLoading(true);
        const remote = await searchSpacesByQuery(baseUrl, term, 10);
        if (reqId !== spaceReqIdRef.current) return;
        setSpaceSuggestions((prev) => {
          const merged = [...prev, ...remote];
          return dedupeByKey(merged, 'key').sort((a, b) => a.name.localeCompare(b.name)).slice(0, 20);
        });
      } catch {
        // non-fatal
      } finally {
        if (reqId === spaceReqIdRef.current) setSpaceLookupLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [spaceInput, baseUrl]);

  useEffect(() => {
    const local = contributorOptions.filter((c) => {
      const q = contributorInput.trim().toLowerCase();
      return !q || c.name.toLowerCase().includes(q) || c.key.toLowerCase().includes(q);
    });
    setContributorSuggestions(local.slice(0, 20));
    setContributorActiveIndex(-1);
  }, [contributorInput, contributorOptions]);

  useEffect(() => {
    const term = contributorInput.trim();
    if (term.length < 2) {
      setContributorLookupLoading(false);
      return undefined;
    }
    const reqId = ++contributorReqIdRef.current;
    const handle = setTimeout(async () => {
      try {
        setContributorLookupLoading(true);
        const remote = await searchUsersByQuery(baseUrl, term, 10);
        if (reqId !== contributorReqIdRef.current) return;
        setContributorSuggestions((prev) => {
          const merged = [...prev, ...remote];
          return dedupeByKey(merged, 'key').sort((a, b) => a.name.localeCompare(b.name)).slice(0, 20);
        });
      } catch {
        // non-fatal
      } finally {
        if (reqId === contributorReqIdRef.current) setContributorLookupLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [contributorInput, baseUrl]);

  useEffect(() => {
    if (!spaceDropdownOpen) setSpaceActiveIndex(-1);
  }, [spaceDropdownOpen]);

  useEffect(() => {
    if (!contributorDropdownOpen) setContributorActiveIndex(-1);
  }, [contributorDropdownOpen]);

  useEffect(() => {
    const maxIndex = Math.max(-1, spaceSuggestions.length - 1);
    if (spaceActiveIndex > maxIndex) {
      setSpaceActiveIndex(maxIndex);
    }
  }, [spaceSuggestions, spaceActiveIndex]);

  useEffect(() => {
    const maxIndex = Math.max(-1, contributorSuggestions.length - 1);
    if (contributorActiveIndex > maxIndex) {
      setContributorActiveIndex(maxIndex);
    }
  }, [contributorSuggestions, contributorActiveIndex]);

  useEffect(() => {
    if (!spaceDropdownOpen || spaceActiveIndex < 0) return;
    const highlighted = spaceBoxRef.current?.querySelector('.space-options .combo-option.highlighted');
    highlighted?.scrollIntoView({ block: 'nearest' });
  }, [spaceDropdownOpen, spaceActiveIndex, spaceSuggestions]);

  useEffect(() => {
    if (!contributorDropdownOpen || contributorActiveIndex < 0) return;
    const highlighted = contributorBoxRef.current?.querySelector('.contributor-options .combo-option.highlighted');
    highlighted?.scrollIntoView({ block: 'nearest' });
  }, [contributorDropdownOpen, contributorActiveIndex, contributorSuggestions]);

  const treeRoots = useMemo(() => buildTree(filteredResults, baseUrl), [filteredResults, baseUrl]);
  const aiSpaceIconUrl = useMemo(() => (
    resolveConfluenceIconUrl(baseUrl, aiActiveItem?.space?.icon?.path || '', fallbackSpaceIcon)
  ), [baseUrl, aiActiveItem]);
  const aiContributorIconUrl = useMemo(() => (
    resolveConfluenceIconUrl(baseUrl, aiActiveItem?.history?.createdBy?.profilePicture?.path || '', fallbackUserIcon)
  ), [baseUrl, aiActiveItem]);
  const aiContributorName = useMemo(
    () => aiActiveItem?.history?.createdBy?.displayName || aiActiveItem?.history?.createdBy?.username || 'Unknown',
    [aiActiveItem],
  );
  const aiSummaryDirection = useMemo(() => detectDirectionFromHtml(aiSummaryHtml), [aiSummaryHtml]);

  useEffect(() => {
    let alive = true;

    const directSpaceUrl = aiSpaceIconUrl || fallbackSpaceIcon;
    const directContributorUrl = aiContributorIconUrl || fallbackUserIcon;
    setAiSpaceIconSrc(directSpaceUrl);
    setAiContributorIconSrc(directContributorUrl);

    if (!modalOnlyMode) return () => { alive = false; };

    (async () => {
      try {
        if (directSpaceUrl && !directSpaceUrl.startsWith('data:')) {
          const bridgedSpace = await fetchImageDataUrlViaHostBridge(directSpaceUrl, 12000);
          if (alive && bridgedSpace) setAiSpaceIconSrc(bridgedSpace);
        }
      } catch {
        // Keep direct URL or fallback
      }
    })();

    (async () => {
      try {
        if (directContributorUrl && !directContributorUrl.startsWith('data:')) {
          const bridgedContributor = await fetchImageDataUrlViaHostBridge(directContributorUrl, 12000);
          if (alive && bridgedContributor) setAiContributorIconSrc(bridgedContributor);
        }
      } catch {
        // Keep direct URL or fallback
      }
    })();

    return () => { alive = false; };
  }, [modalOnlyMode, aiSpaceIconUrl, aiContributorIconUrl]);
  const tableColumns = useMemo(() => {
    const cols = [
      { key: 'type', label: 'Type' },
      { key: 'name', label: 'Name' },
      { key: 'space', label: 'Space' },
      { key: 'contributor', label: 'Contributor' },
      { key: 'created', label: 'Created' },
      { key: 'modified', label: 'Modified' },
    ];
    if (enableSummaries) cols.push({ key: 'ai', label: 'AI' });
    return cols;
  }, [enableSummaries]);
  const tableMinWidth = useMemo(
    () => tableColumns.reduce((sum, col) => sum + (tableColWidths[col.key] || DEFAULT_TABLE_COL_WIDTHS[col.key] || 120), 0),
    [tableColumns, tableColWidths],
  );
  const savedSearchesFiltered = useMemo(() => {
    const q = savedSearchQuery.toLowerCase().trim();
    const sorted = [...savedSearches].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!q) return sorted;
    return sorted.filter((entry) => {
      const text = (entry.filters?.text?.label || entry.filters?.text?.key || '').toLowerCase();
      const space = (entry.filters?.space?.label || entry.filters?.space?.key || '').toLowerCase();
      const contributor = (entry.filters?.contributor?.label || entry.filters?.contributor?.key || '').toLowerCase();
      const type = (entry.filters?.type || '').toLowerCase();
      const date = (entry.filters?.date || '').toLowerCase();
      const search = (entry.searchText || '').toLowerCase();
      const name = (entry.name || '').toLowerCase();
      return name.includes(q) || search.includes(q) || text.includes(q) || space.includes(q) || contributor.includes(q) || type.includes(q) || date.includes(q);
    });
  }, [savedSearches, savedSearchQuery]);
  const aiModelOptions = useMemo(() => {
    if (AI_MODEL_OPTIONS.some((opt) => opt.value === selectedAiModel)) return AI_MODEL_OPTIONS;
    return [{ value: selectedAiModel, label: `${selectedAiModel} (custom)` }, ...AI_MODEL_OPTIONS];
  }, [selectedAiModel]);
  const isInitialSearching = (initialSearchPending || loading) && allResults.length === 0 && !!searchText;

  const fetchMore = async () => {
    if (!searchText || !baseUrl || loading || allLoaded || inflightRef.current) return;
    const isInitialFetch = start === 0 && allResults.length === 0;
    inflightRef.current = true;
    setLoading(true);

    try {
      const cql = cqlFromState(searchText, filterType, filterDate, filterSpace, filterContributor);
      const url = `${baseUrl}/rest/api/content/search?cql=${cql}&limit=${resultsPerRequest}&start=${start}&expand=ancestors,space.icon,history.createdBy,version`;

      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
      });

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const data = await res.json();
      const list = Array.isArray(data.results) ? data.results : [];
      const total = Number.isInteger(data.totalSize) ? data.totalSize : 0;
      setTotalSize(total);

      setAllResults((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        const merged = prev.slice();
        list.forEach((item) => {
          if (!seen.has(item.id)) merged.push(item);
        });
        return merged;
      });

      const nextStart = start + list.length;
      setStart(nextStart);
      if (list.length === 0 || nextStart >= total) setAllLoaded(true);
    } catch (err) {
      console.error('[V2 Preact] Search failed:', err);
      setAllLoaded(true);
      openNoticeDialog({
        title: 'Search Failed',
        message: err.message || 'Unknown error',
        tone: 'error',
      });
    } finally {
      inflightRef.current = false;
      setLoading(false);
      if (isInitialFetch) setInitialSearchPending(false);
    }
  };

  useEffect(() => {
    if (!searchText || loading || allLoaded) return;
    if (start !== 0 || allResults.length !== 0) return;
    fetchMore();
  }, [searchText, baseUrl, resultsPerRequest, filterDate, filterType, filterSpace, filterContributor, start, allResults.length, loading, allLoaded]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const onScroll = () => {
      const nearBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 12;
      if (nearBottom) fetchMore();
      setShowScrollTop(scroller.scrollTop > 250);
    };

    scroller.addEventListener('scroll', onScroll);
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [loading, allLoaded, searchText, start, filterDate, filterType, filterSpace, filterContributor, baseUrl, resultsPerRequest]);

  useEffect(() => {
    const onResize = () => {
      const maxWidth = Math.max(MIN_AI_MODAL_WIDTH, window.innerWidth - 24);
      setAiModalWidth((prev) => Math.max(MIN_AI_MODAL_WIDTH, Math.min(maxWidth, prev)));
      const maxHeight = Math.max(MIN_AI_MODAL_HEIGHT, window.innerHeight - 32);
      setAiModalHeight((prev) => Math.max(MIN_AI_MODAL_HEIGHT, Math.min(maxHeight, prev)));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (modalOnlyMode || !shouldFocusSearchFromQuery || didAutoFocusSearchRef.current) return;
    let clearAttentionTimer = null;
    const timer = setTimeout(() => {
      const input = searchInputRef.current;
      if (!input) return;
      input.focus();
      setSearchInputAttention(true);
      clearAttentionTimer = setTimeout(() => setSearchInputAttention(false), 2800);
      didAutoFocusSearchRef.current = true;
    }, 0);
    return () => {
      clearTimeout(timer);
      if (clearAttentionTimer) clearTimeout(clearAttentionTimer);
    };
  }, [modalOnlyMode, shouldFocusSearchFromQuery]);

  const runSearch = () => {
    const next = searchInput.trim();
    if (!next) {
      openNoticeDialog({
        title: 'Search Query Required',
        message: 'Please enter a search query.',
        tone: 'info',
      });
      return;
    }

    setInitialSearchPending(true);
    resetLoadedData();
    setSearchText(next);
    updateUrlParams({
      searchText: next,
      baseUrl,
      text: filterText.trim(),
      space: filterSpace ? `${filterSpace}:${spaceInput.trim() || filterSpace}` : '',
      contributor: filterContributor ? `${filterContributor}:${contributorInput.trim() || filterContributor}` : '',
      date: filterDate,
      type: filterType,
    });
  };

  const applySpaceFilter = (space) => {
    const nextKey = space?.key || '';
    const nextLabel = space?.name || '';
    setFilterSpace(nextKey);
    setSpaceInput(nextLabel);
    setSelectedSpaceIcon(space?.iconUrl || '');
    setSpaceDropdownOpen(false);
    setSpaceActiveIndex(-1);
    updateUrlParams({
      searchText,
      baseUrl,
      text: filterText.trim(),
      space: nextKey ? `${nextKey}:${nextLabel || nextKey}` : '',
      contributor: filterContributor ? `${filterContributor}:${contributorInput.trim() || filterContributor}` : '',
      date: filterDate,
      type: filterType,
    });
  };

  const applyContributorFilter = (contributor) => {
    const nextKey = contributor?.key || '';
    const nextLabel = contributor?.name || '';
    setFilterContributor(nextKey);
    setContributorInput(nextLabel);
    setSelectedContributorIcon(contributor?.avatarUrl || '');
    setContributorDropdownOpen(false);
    setContributorActiveIndex(-1);
    updateUrlParams({
      searchText,
      baseUrl,
      text: filterText.trim(),
      space: filterSpace ? `${filterSpace}:${spaceInput.trim() || filterSpace}` : '',
      contributor: nextKey ? `${nextKey}:${nextLabel || nextKey}` : '',
      date: filterDate,
      type: filterType,
    });
  };

  const handleSpaceInputKeyDown = (event) => {
    const totalOptions = spaceSuggestions.length;
    if (totalOptions <= 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!spaceDropdownOpen) setSpaceDropdownOpen(true);
      setSpaceActiveIndex((prev) => Math.min(totalOptions - 1, Math.max(0, prev + 1)));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!spaceDropdownOpen) setSpaceDropdownOpen(true);
      setSpaceActiveIndex((prev) => Math.max(0, prev <= 0 ? 0 : prev - 1));
      return;
    }

    if (event.key === 'Enter' && spaceDropdownOpen && spaceActiveIndex >= 0) {
      event.preventDefault();
      applySpaceFilter(spaceSuggestions[spaceActiveIndex] || null);
      return;
    }

    if (event.key === 'Escape') {
      setSpaceDropdownOpen(false);
      setSpaceActiveIndex(-1);
    }
  };

  const handleContributorInputKeyDown = (event) => {
    const totalOptions = contributorSuggestions.length;
    if (totalOptions <= 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!contributorDropdownOpen) setContributorDropdownOpen(true);
      setContributorActiveIndex((prev) => Math.min(totalOptions - 1, Math.max(0, prev + 1)));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!contributorDropdownOpen) setContributorDropdownOpen(true);
      setContributorActiveIndex((prev) => Math.max(0, prev <= 0 ? 0 : prev - 1));
      return;
    }

    if (event.key === 'Enter' && contributorDropdownOpen && contributorActiveIndex >= 0) {
      event.preventDefault();
      applyContributorFilter(contributorSuggestions[contributorActiveIndex] || null);
      return;
    }

    if (event.key === 'Escape') {
      setContributorDropdownOpen(false);
      setContributorActiveIndex(-1);
    }
  };

  const toggleNode = (id) => {
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openOptions = () => {
    if (chrome.runtime?.openOptionsPage) chrome.runtime.openOptionsPage();
  };

  const toggleDarkMode = () => {
    const nextDarkMode = !isDarkMode;
    setIsDarkMode(nextDarkMode);
    document.body.classList.toggle('dark-mode', nextDarkMode);
    chrome.storage.sync.set({ darkMode: nextDarkMode });
  };

  const changeAiModel = (nextModel) => {
    const normalized = retiredModelFallbacks[nextModel] || nextModel || DEFAULT_AI_MODEL;
    setSelectedAiModel(normalized);
    chrome.storage.sync.set({ selectedAiModel: normalized });
  };

  const positionTreeTooltip = (x, y) => {
    const tip = treeTooltipRef.current;
    if (!tip) return;
    const pad = 12;
    const tipWidth = tip.offsetWidth || 340;
    const tipHeight = tip.offsetHeight || 180;
    let left = x + 14;
    let top = y + 14;
    if (left + tipWidth > window.innerWidth - pad) {
      left = Math.max(pad, x - tipWidth - 14);
    }
    if (top + tipHeight > window.innerHeight - pad) {
      top = Math.max(pad, y - tipHeight - 14);
    }
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };

  const showTreeTooltip = (event, node) => {
    if (!showTreeTooltips || !node) return;
    const source = node.sourceItem || {};
    const contributor = source.history?.createdBy?.displayName || 'Unknown';
    const modified = formatDate(source.version?.when);
    const type = source.type || node.type || 'page';
    const spaceName = source.space?.name || 'Unknown space';
    const spaceIconUrl = resolveConfluenceIconUrl(baseUrl, source.space?.icon?.path || '', fallbackSpaceIcon);
    const avatarUrl = resolveConfluenceIconUrl(baseUrl, source.history?.createdBy?.profilePicture?.path || '', fallbackUserIcon);

    treeTooltipPointerRef.current = { x: event.clientX, y: event.clientY };
    setTreeTooltipData({
      title: node.title || source.title || 'Untitled',
      url: node.url || buildConfluenceUrl(baseUrl, source._links?.webui),
      type,
      contributor,
      modified,
      spaceName,
      spaceIconUrl,
      avatarUrl,
    });
  };

  const moveTreeTooltip = (event, node) => {
    if (!showTreeTooltips || !node || !treeTooltipRef.current) return;
    treeTooltipPointerRef.current = { x: event.clientX, y: event.clientY };
    positionTreeTooltip(event.clientX, event.clientY);
  };

  const hideTreeTooltip = () => {
    setTreeTooltipData(null);
  };

  const handleTreeViewClick = () => {
    if (view !== 'tree') {
      setView('tree');
      return;
    }

    const expandableIds = collectExpandableNodeIds(treeRoots);
    if (expandableIds.length === 0) return;

    setCollapsedNodes((prev) => {
      const hasExpandedNodes = expandableIds.some((id) => !prev.has(id));
      const next = new Set(prev);
      if (hasExpandedNodes) {
        expandableIds.forEach((id) => next.add(id));
      } else {
        expandableIds.forEach((id) => next.delete(id));
      }
      return next;
    });
  };

  const startAiModalResize = (event, direction) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = aiModalRef.current?.offsetWidth || aiModalWidth;

    const onMove = (moveEvent) => {
      const delta = direction === 'right'
        ? moveEvent.clientX - startX
        : startX - moveEvent.clientX;
      const maxWidth = Math.max(MIN_AI_MODAL_WIDTH, window.innerWidth - 24);
      const nextWidth = Math.max(MIN_AI_MODAL_WIDTH, Math.min(maxWidth, startWidth + (2 * delta)));
      setAiModalWidth(nextWidth);
      sessionStorage.setItem('aiModalWidth', String(nextWidth));
    };

    const onStop = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onStop);
      document.body.style.cursor = '';
    };

    document.body.style.cursor = 'ew-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onStop);
  };

  const resetAiModalWidth = () => {
    setAiModalWidth(DEFAULT_AI_MODAL_WIDTH);
    sessionStorage.removeItem('aiModalWidth');
  };

  const startAiModalHeightResize = (event, edge = 'bottom') => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = aiModalRef.current?.offsetHeight || aiModalHeight;

    const onMove = (moveEvent) => {
      const delta = moveEvent.clientY - startY;
      const maxHeight = Math.max(MIN_AI_MODAL_HEIGHT, window.innerHeight - 32);
      const adjustedDelta = edge === 'top' ? -delta : delta;
      const nextHeight = Math.max(MIN_AI_MODAL_HEIGHT, Math.min(maxHeight, startHeight + (2 * adjustedDelta)));
      setAiModalHeight(nextHeight);
      sessionStorage.setItem('aiModalHeight', String(nextHeight));
    };

    const onStop = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onStop);
      document.body.style.cursor = '';
    };

    document.body.style.cursor = 'ns-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onStop);
  };

  const resetAiModalHeight = () => {
    setAiModalHeight(DEFAULT_AI_MODAL_HEIGHT);
    sessionStorage.removeItem('aiModalHeight');
  };

  const startAiQuestionInputResize = (event) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = aiQuestionInputRef.current?.offsetHeight || aiQuestionInputHeight;

    const onMove = (moveEvent) => {
      const delta = startY - moveEvent.clientY;
      const nextHeight = Math.max(
        MIN_AI_QUESTION_HEIGHT,
        Math.min(MAX_AI_QUESTION_HEIGHT, startHeight + delta),
      );
      setAiQuestionInputHeight(nextHeight);
      sessionStorage.setItem('aiQuestionInputHeight', String(nextHeight));
    };

    const onStop = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onStop);
      document.body.style.cursor = '';
    };

    document.body.style.cursor = 'ns-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onStop);
  };

  const resetAiQuestionInputHeight = () => {
    setAiQuestionInputHeight(DEFAULT_AI_QUESTION_HEIGHT);
    sessionStorage.removeItem('aiQuestionInputHeight');
  };

  const startTableColumnResize = (event, columnKey) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = tableColWidths[columnKey] || DEFAULT_TABLE_COL_WIDTHS[columnKey] || 120;

    const onMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = Math.max(MIN_TABLE_COL_WIDTH, startWidth + delta);
      setTableColWidths((prev) => {
        const next = { ...prev, [columnKey]: nextWidth };
        sessionStorage.setItem('v2TableColWidths', JSON.stringify(next));
        return next;
      });
    };

    const onStop = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onStop);
      document.body.style.cursor = '';
    };

    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onStop);
  };

  const resetTableColumnWidth = (columnKey) => {
    setTableColWidths((prev) => {
      const next = { ...prev, [columnKey]: DEFAULT_TABLE_COL_WIDTHS[columnKey] || 120 };
      sessionStorage.setItem('v2TableColWidths', JSON.stringify(next));
      return next;
    });
  };

  const startAiPaneResize = (event) => {
    if (isAiSummaryCollapsed || isAiChatCollapsed) return;
    event.preventDefault();
    const layout = aiLayoutRef.current;
    if (!layout) return;
    const rect = layout.getBoundingClientRect();

    const onMove = (moveEvent) => {
      const ratio = (moveEvent.clientX - rect.left) / rect.width;
      const nextRatio = Math.max(MIN_AI_SUMMARY_PANE_RATIO, Math.min(MAX_AI_SUMMARY_PANE_RATIO, ratio));
      setAiSummaryPaneRatio(nextRatio);
      sessionStorage.setItem('aiSummaryPaneRatio', String(nextRatio));
    };

    const onStop = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onStop);
      document.body.style.cursor = '';
    };

    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onStop);
  };

  const resetAiSummaryPaneRatio = () => {
    setAiSummaryPaneRatio(DEFAULT_AI_SUMMARY_PANE_RATIO);
    sessionStorage.removeItem('aiSummaryPaneRatio');
  };

  const toggleSummaryPane = () => {
    setIsAiSummaryCollapsed((prev) => {
      const next = !prev;
      if (next && isAiChatCollapsed) setIsAiChatCollapsed(false);
      return next;
    });
  };

  const toggleChatPane = () => {
    setIsAiChatCollapsed((prev) => {
      const next = !prev;
      if (next && isAiSummaryCollapsed) setIsAiSummaryCollapsed(false);
      return next;
    });
  };

  const openSavedSearches = async () => {
    await loadSavedSearches();
    setSavedSearchQuery('');
    setSavedModalOpen(true);
  };

  const openSaveNameDialog = ({
    title,
    initialValue = '',
    confirmLabel = 'Save',
    placeholder = 'Enter a name',
  }) => new Promise((resolve) => {
    saveNameDialogResolverRef.current = resolve;
    setSaveNameDialog({
      open: true,
      title,
      value: initialValue,
      confirmLabel,
      placeholder,
    });
  });

  const closeSaveNameDialog = (value = null) => {
    const resolver = saveNameDialogResolverRef.current;
    saveNameDialogResolverRef.current = null;
    setSaveNameDialog((prev) => ({ ...prev, open: false, value: '' }));
    if (typeof resolver === 'function') resolver(value);
  };

  const handleSaveNameDialogSubmit = () => {
    closeSaveNameDialog(saveNameDialog.value);
  };

  const saveCurrentSearch = async () => {
    if (!searchText.trim()) {
      openNoticeDialog({
        title: 'Nothing to Save',
        message: 'Run a search before saving.',
        tone: 'info',
      });
      return;
    }

    const suggested = buildDefaultSavedName();
    const entered = await openSaveNameDialog({
      title: 'Name this search',
      initialValue: suggested,
      confirmLabel: 'Save',
      placeholder: 'Search name',
    });
    if (entered === null) return;

    const labelBySpaceKey = new Map(spaceOptions.map((x) => [x.key, x.name]));
    const labelByContributorKey = new Map(contributorOptions.map((x) => [x.key, x.name]));
    const finalName = ensureUniqueName(entered.trim() || suggested, savedSearches);

    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      name: finalName,
      searchText: searchText.trim(),
      baseUrl: baseUrl.trim(),
      filters: {
        text: { key: filterText.trim(), label: filterText.trim() },
        space: {
          key: filterSpace,
          label: filterSpace ? (spaceInput.trim() || labelBySpaceKey.get(filterSpace) || filterSpace) : '',
        },
        contributor: {
          key: filterContributor,
          label: filterContributor ? (contributorInput.trim() || labelByContributorKey.get(filterContributor) || filterContributor) : '',
        },
        date: filterDate,
        type: filterType,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      await storeSavedSearch(entry);
      await loadSavedSearches();
      openNoticeDialog({
        title: 'Saved',
        message: 'Search saved.',
        tone: 'success',
      });
    } catch (err) {
      console.error('[V2 Preact] Failed to save search:', err);
      openNoticeDialog({
        title: 'Failed to Save Search',
        message: err.message || 'Unknown error',
        tone: 'error',
      });
    }
  };

  const runSavedSearch = (entry) => {
    const nextBase = (entry.baseUrl || baseUrl).trim();
    const nextSearchText = (entry.searchText || '').trim();
    if (!nextBase || !nextSearchText) {
      openNoticeDialog({
        title: 'Saved Search Is Invalid',
        message: 'Saved search is missing base URL or query.',
        tone: 'error',
      });
      return;
    }

    const nextDate = entry.filters?.date || 'any';
    const nextType = entry.filters?.type || '';

    setInitialSearchPending(true);
    resetLoadedData();
    setBaseUrl(nextBase);
    setSearchInput(nextSearchText);
    setSearchText(nextSearchText);
    setFilterText(entry.filters?.text?.key || '');
    setFilterSpace(entry.filters?.space?.key || '');
    setSpaceInput(entry.filters?.space?.label || entry.filters?.space?.key || '');
    setSelectedSpaceIcon('');
    setFilterContributor(entry.filters?.contributor?.key || '');
    setContributorInput(entry.filters?.contributor?.label || entry.filters?.contributor?.key || '');
    setSelectedContributorIcon('');
    setFilterDate(nextDate);
    setFilterType(nextType);
    setSavedModalOpen(false);

    updateUrlParams({
      searchText: nextSearchText,
      baseUrl: nextBase,
      text: entry.filters?.text?.key || '',
      space: entry.filters?.space?.key ? `${entry.filters.space.key}:${entry.filters?.space?.label || entry.filters.space.key}` : '',
      contributor: entry.filters?.contributor?.key ? `${entry.filters.contributor.key}:${entry.filters?.contributor?.label || entry.filters.contributor.key}` : '',
      date: nextDate,
      type: nextType,
    });
  };

  const renameSavedSearch = async (entry) => {
    const entered = await openSaveNameDialog({
      title: 'Rename saved search',
      initialValue: entry.name || '',
      confirmLabel: 'Rename',
      placeholder: 'Saved search name',
    });
    if (entered === null) return;
    const trimmed = entered.trim();
    if (!trimmed) {
      openNoticeDialog({
        title: 'Invalid Name',
        message: 'Name cannot be empty.',
        tone: 'info',
      });
      return;
    }

    const renamed = {
      ...entry,
      name: ensureUniqueName(trimmed, savedSearches, entry.id),
      updatedAt: Date.now(),
    };
    try {
      await storeSavedSearch(renamed);
      setSavedSearches((prev) => prev.map((it) => (it.id === entry.id ? renamed : it)));
    } catch (err) {
      console.error('[V2 Preact] Failed to rename saved search:', err);
      openNoticeDialog({
        title: 'Failed to Rename Saved Search',
        message: err.message || 'Unknown error',
        tone: 'error',
      });
    }
  };

  const removeSavedSearch = async (entry) => {
    const confirmed = await openConfirmDialog({
      title: 'Delete saved search?',
      message: `Delete "${entry.name}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteSavedSearch(entry.id);
      setSavedSearches((prev) => prev.filter((it) => it.id !== entry.id));
    } catch (err) {
      console.error('[V2 Preact] Failed to delete saved search:', err);
      openNoticeDialog({
        title: 'Failed to Delete Saved Search',
        message: err.message || 'Unknown error',
        tone: 'error',
      });
    }
  };

  const removeAllSavedSearches = async () => {
    const confirmed = await openConfirmDialog({
      title: 'Clear all saved searches?',
      message: 'This will permanently remove all saved searches.',
      confirmLabel: 'Clear All',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await clearAllSavedSearches();
      setSavedSearches([]);
    } catch (err) {
      console.error('[V2 Preact] Failed to clear saved searches:', err);
      openNoticeDialog({
        title: 'Failed to Clear Saved Searches',
        message: err.message || 'Unknown error',
        tone: 'error',
      });
    }
  };

  return (
    <div class={`v2-root ${modalOnlyMode ? 'modal-only' : ''}`}>
      <header class="topbar">
        <div class="topbar-inner">
          <div class="topbar-head">
            <div class="brand-wrap">
              <img class="brand-logo" src="../../assets/logo.png" alt="Enhanced Search Results" />
              <h1>{domainName}</h1>
            </div>
            <div class="topbar-actions">
              <button
                class="icon-btn topbar-icon-btn"
                onClick={toggleDarkMode}
                title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {isDarkMode ? (
                  <span class="theme-moon-emoji" aria-hidden="true">🌙</span>
                ) : (
                  <svg class="theme-icon-svg sun" viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="4.8" fill="#f59e0b" />
                    <g stroke="#fbbf24" stroke-width="1.7" stroke-linecap="round">
                      <path d="M12 2.4v2.2M12 19.4v2.2M4.6 12H2.4M21.6 12h-2.2M5.9 5.9l1.6 1.6M18.1 18.1l-1.6-1.6M18.1 5.9l-1.6 1.6M5.9 18.1l1.6-1.6" />
                    </g>
                  </svg>
                )}
              </button>
              <button class="icon-btn topbar-icon-btn settings-btn" onClick={openOptions} title="Settings">
                <svg class="settings-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M19.14 12.94a7.48 7.48 0 0 0 .05-.94 7.48 7.48 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.63l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.57.22-1.11.53-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.7 8.85a.5.5 0 0 0 .12.63l2.03 1.58a7.48 7.48 0 0 0-.05.94 7.48 7.48 0 0 0 .05.94L2.82 14.52a.5.5 0 0 0-.12.63l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.41 1.05.72 1.62.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.57-.22 1.11-.53 1.62-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.63l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </div>
          </div>

          <div class="search-row">
            <div class="search-input-wrap">
              <input
                ref={searchInputRef}
                class={`search-input ${searchInputAttention ? 'search-input-attention' : ''}`.trim()}
                value={searchInput}
                onInput={(e) => setSearchInput(e.currentTarget.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                dir="auto"
                lang="und"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                placeholder="Enter new search query..."
              />
              {searchInput && (
                <button class="clear-btn" onClick={() => setSearchInput('')} title="Clear">&times;</button>
              )}
            </div>
            <button class="search-btn" onClick={runSearch}>Search</button>
          </div>
        </div>
      </header>

      <main class="content-grid">
        <aside class="panel sidebar">
          <h3>Filters</h3>

          <div class="field with-icon">
            <span class="field-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.2-4.2M10.8 18a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
            </span>
            <input value={filterText} onInput={(e) => setFilterText(e.currentTarget.value)} placeholder="Filter by text" />
          </div>

          <div class="field combo-field" ref={spaceBoxRef}>
            <div class="combo-input-wrap with-icon">
              {filterSpace ? (
                <img
                  class="field-icon selected-filter-icon"
                  src={selectedSpaceIcon || fallbackSpaceIcon}
                  alt=""
                  onError={(e) => { e.currentTarget.src = fallbackSpaceIcon; }}
                />
              ) : (
                <span class="field-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5a2 2 0 0 1 2-2H11l1.5 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-10Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /></svg>
                </span>
              )}
              <input
                value={spaceInput}
                onInput={(e) => {
                  setSpaceInput(e.currentTarget.value);
                  setFilterSpace('');
                  setSpaceDropdownOpen(true);
                  setSpaceActiveIndex(-1);
                }}
                onFocus={() => setSpaceDropdownOpen(true)}
                onKeyDown={handleSpaceInputKeyDown}
                placeholder="Filter spaces (type to search)"
              />
              {filterSpace && (
                <button
                  class="combo-clear-selected"
                  onClick={() => {
                    applySpaceFilter(null);
                    setSpaceInput('');
                  }}
                  title="Clear selected space"
                >
                  ×
                </button>
              )}
              {spaceLookupLoading && <span class="combo-status">Searching...</span>}
            </div>
            {spaceDropdownOpen && (
              <div class="combo-options space-options">
                {spaceSuggestions.map((space, idx) => (
                  <button
                    key={space.key}
                    class={`combo-option ${spaceActiveIndex === idx ? 'highlighted' : ''}`}
                    onMouseEnter={() => setSpaceActiveIndex(idx)}
                    onClick={() => applySpaceFilter(space)}
                  >
                    <img src={space.iconUrl} alt="" />
                    <span>{space.name}</span>
                  </button>
                ))}
                {spaceSuggestions.length === 0 && <div class="combo-empty">No spaces found.</div>}
              </div>
            )}
          </div>

          <div class="field combo-field" ref={contributorBoxRef}>
            <div class="combo-input-wrap with-icon">
              {filterContributor ? (
                <img
                  class="field-icon selected-filter-icon"
                  src={selectedContributorIcon || fallbackUserIcon}
                  alt=""
                  onError={(e) => { e.currentTarget.src = fallbackUserIcon; }}
                />
              ) : (
                <span class="field-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.4" fill="none" stroke="currentColor" stroke-width="1.7" /><path d="M5 19a7 7 0 0 1 14 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
                </span>
              )}
              <input
                value={contributorInput}
                onInput={(e) => {
                  setContributorInput(e.currentTarget.value);
                  setFilterContributor('');
                  setContributorDropdownOpen(true);
                  setContributorActiveIndex(-1);
                }}
                onFocus={() => setContributorDropdownOpen(true)}
                onKeyDown={handleContributorInputKeyDown}
                placeholder="Filter contributors (type to search)"
              />
              {filterContributor && (
                <button
                  class="combo-clear-selected"
                  onClick={() => {
                    applyContributorFilter(null);
                    setContributorInput('');
                  }}
                  title="Clear selected contributor"
                >
                  ×
                </button>
              )}
              {contributorLookupLoading && <span class="combo-status">Searching...</span>}
            </div>
            {contributorDropdownOpen && (
              <div class="combo-options contributor-options">
                {contributorSuggestions.map((contributor, idx) => (
                  <button
                    key={contributor.key}
                    class={`combo-option ${contributorActiveIndex === idx ? 'highlighted' : ''}`}
                    onMouseEnter={() => setContributorActiveIndex(idx)}
                    onClick={() => applyContributorFilter(contributor)}
                  >
                    <img src={contributor.avatarUrl} alt="" />
                    <span>{contributor.name}</span>
                  </button>
                ))}
                {contributorSuggestions.length === 0 && <div class="combo-empty">No contributors found.</div>}
              </div>
            )}
          </div>

          <div class="field with-icon">
            <span class="field-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.7" /><path d="M8 3.5v3M16 3.5v3M4 9.3h16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
            </span>
            <select
              value={filterDate}
              onChange={(e) => {
                setFilterDate(e.currentTarget.value);
                updateUrlParams({
                  searchText,
                  baseUrl,
                  text: filterText.trim(),
                  space: filterSpace ? `${filterSpace}:${spaceInput.trim() || filterSpace}` : '',
                  contributor: filterContributor ? `${filterContributor}:${contributorInput.trim() || filterContributor}` : '',
                  date: e.currentTarget.value,
                  type: filterType,
                });
              }}
            >
              <option value="any">Any time</option>
              <option value="1d">Past day</option>
              <option value="1w">Past week</option>
              <option value="1m">Past month</option>
              <option value="1y">Past year</option>
            </select>
          </div>

          <div class="field with-icon">
            <span class="field-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7.5h15M4.5 12h15M4.5 16.5h15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /><circle cx="9" cy="7.5" r="1.3" fill="currentColor" /><circle cx="14" cy="12" r="1.3" fill="currentColor" /><circle cx="11" cy="16.5" r="1.3" fill="currentColor" /></svg>
            </span>
            <select
              value={filterType}
              onChange={(e) => {
                setFilterType(e.currentTarget.value);
                updateUrlParams({
                  searchText,
                  baseUrl,
                  text: filterText.trim(),
                  space: filterSpace ? `${filterSpace}:${spaceInput.trim() || filterSpace}` : '',
                  contributor: filterContributor ? `${filterContributor}:${contributorInput.trim() || filterContributor}` : '',
                  date: filterDate,
                  type: e.currentTarget.value,
                });
              }}
            >
              <option value="">📚 All Types</option>
              <option value="page">📄 Page</option>
              <option value="blogpost">📰 Blog post</option>
              <option value="attachment">📎 Attachment</option>
              <option value="comment">💬 Comment</option>
            </select>
          </div>

          <h3 class="section-title">Saved Searches</h3>
          <div class="btn-row">
            <button class="btn view-btn" onClick={saveCurrentSearch}>
              <img class="view-btn-icon" src="../../assets/icons/save-search-button.png" alt="" />
              <span>Save</span>
            </button>
            <button class="btn view-btn" onClick={openSavedSearches}>
              <img class="view-btn-icon" src="../../assets/icons/load-search-button.png" alt="" />
              <span>Load</span>
            </button>
          </div>

          <h3 class="section-title">Views</h3>
          <div class="btn-row">
            <button class={`btn view-btn ${view === 'tree' ? 'active' : ''}`} onClick={handleTreeViewClick}>
              <img class="view-btn-icon" src="../../assets/icons/tree-view-button.png" alt="" />
              <span>Tree</span>
            </button>
            <button class={`btn view-btn ${view === 'table' ? 'active' : ''}`} onClick={() => setView('table')}>
              <img class="view-btn-icon" src="../../assets/icons/table-view-button.png" alt="" />
              <span>Table</span>
            </button>
          </div>

          <h3 class="section-title">AI</h3>
          <div class="field">
            <select value={selectedAiModel} onChange={(e) => changeAiModel(e.currentTarget.value)}>
              {aiModelOptions.map((modelOpt) => (
                <option key={modelOpt.value} value={modelOpt.value}>{modelOpt.label}</option>
              ))}
            </select>
          </div>

          <div class="meta">
            {loading && allResults.length === 0
              ? 'Loading...'
              : `Showing ${filteredResults.length} (${allResults.length}/${totalSize ?? '…'} loaded)`}
          </div>
        </aside>

        <section class="panel results">
          <div class={`results-scroll ${view === 'table' ? 'table-mode' : ''}`} ref={scrollerRef}>
            {view === 'tree' ? (
              treeRoots.length === 0 ? (
                isInitialSearching ? (
                  <div class="searching-state">
                    <div class="searching-title">Searching Confluence...</div>
                    <div class="typing-dots">
                      <span class="dot" />
                      <span class="dot" />
                      <span class="dot" />
                    </div>
                  </div>
                ) : (
                  <div class="empty">{searchText ? 'No results to display.' : 'Enter a search query to begin.'}</div>
                )
              ) : (
                <ul class="tree-list root">
                  {treeRoots.map((node) => (
                    <TreeNode
                      key={node.id}
                      node={node}
                      collapsed={collapsedNodes}
                      onToggle={toggleNode}
                      highlightResultRows={highlightResultRows}
                      showTreeTooltips={showTreeTooltips}
                      onShowTooltip={showTreeTooltip}
                      onMoveTooltip={moveTreeTooltip}
                      onHideTooltip={hideTreeTooltip}
                      canSummarize={enableSummaries}
                      aiLoadingItemId={aiItemLoadingId}
                      aiSummaryStatusById={aiSummaryStatusById}
                      onSummarize={openAiSummaryModal}
                    />
                  ))}
                </ul>
              )
            ) : (
              filteredResults.length === 0 ? (
                isInitialSearching ? (
                  <div class="searching-state">
                    <div class="searching-title">Searching Confluence...</div>
                    <div class="typing-dots">
                      <span class="dot" />
                      <span class="dot" />
                      <span class="dot" />
                    </div>
                  </div>
                ) : (
                  <div class="empty">{searchText ? 'No results to display.' : 'Enter a search query to begin.'}</div>
                )
              ) : (
                <table class="results-table" style={{ minWidth: `${tableMinWidth}px` }}>
                  <colgroup>
                    {tableColumns.map((col) => (
                      <col key={`col-${col.key}`} style={{ width: `${tableColWidths[col.key] || DEFAULT_TABLE_COL_WIDTHS[col.key] || 120}px` }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      {tableColumns.map((column) => (
                        <th key={`th-${column.key}`} class="table-head-cell">
                          <span>{column.label}</span>
                          <span
                            class="th-resizer-v2"
                            onMouseDown={(e) => startTableColumnResize(e, column.key)}
                            onDblClick={(e) => {
                              e.stopPropagation();
                              resetTableColumnWidth(column.key);
                            }}
                            title="Drag to resize (double-click to reset)"
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResults.map((item) => {
                      const creator = item.history?.createdBy;
                      const creatorKey = creator?.username || creator?.userKey || creator?.accountId || '';
                      const creatorName = creator?.displayName || 'Unknown';
                      const creatorUrl = creatorKey ? `${baseUrl}/display/~${creatorKey}` : '#';
                      const creatorAvatarUrl = resolveConfluenceIconUrl(baseUrl, creator?.profilePicture?.path || '', fallbackUserIcon);
                      const spaceName = item.space?.name || '';
                      const spaceUrl = buildConfluenceUrl(baseUrl, item.space?._links?.webui);
                      const spaceIconUrl = resolveConfluenceIconUrl(baseUrl, item.space?.icon?.path || '', fallbackSpaceIcon);

                      return (
                        <tr key={item.id}>
                          <td>{typeIcons[item.type] || '📘'}</td>
                          <td class="ellipsis-cell">
                            <a href={buildConfluenceUrl(baseUrl, item._links?.webui)} target="_blank" rel="noreferrer">
                              {item.title || '(Untitled)'}
                            </a>
                          </td>
                          <td class="ellipsis-cell">
                            {spaceName && (
                              <span class={`table-entity-cell ${showTableTooltips ? 'ai-chip-hoverable' : ''}`} tabIndex={showTableTooltips ? 0 : undefined}>
                                <img
                                  class="table-entity-avatar table-entity-avatar-space"
                                  src={spaceIconUrl}
                                  alt=""
                                  onError={(e) => { e.currentTarget.src = fallbackSpaceIcon; }}
                                />
                                <a class="table-entity-name" href={spaceUrl} target="_blank" rel="noreferrer">
                                  {spaceName}
                                </a>
                                {showTableTooltips && (
                                  <span class="ai-chip-popover table-entity-popover" role="tooltip" aria-hidden="true">
                                    <img
                                      class="ai-chip-popover-avatar"
                                      src={spaceIconUrl}
                                      alt=""
                                      onError={(e) => { e.currentTarget.src = fallbackSpaceIcon; }}
                                    />
                                    <span class="ai-chip-popover-meta">
                                      <span class="ai-chip-popover-label">Space</span>
                                      <span class="ai-chip-popover-name">{spaceName}</span>
                                    </span>
                                  </span>
                                )}
                              </span>
                            )}
                          </td>
                          <td class="ellipsis-cell">
                            {creatorName !== 'Unknown' ? (
                              <span class={`table-entity-cell ${showTableTooltips ? 'ai-chip-hoverable' : ''}`} tabIndex={showTableTooltips ? 0 : undefined}>
                                <img
                                  class="table-entity-avatar"
                                  src={creatorAvatarUrl}
                                  alt=""
                                  onError={(e) => { e.currentTarget.src = fallbackUserIcon; }}
                                />
                                <a class="table-entity-name" href={creatorUrl} target="_blank" rel="noreferrer">
                                  {creatorName}
                                </a>
                                {showTableTooltips && (
                                  <span class="ai-chip-popover table-entity-popover" role="tooltip" aria-hidden="true">
                                    <img
                                      class="ai-chip-popover-avatar"
                                      src={creatorAvatarUrl}
                                      alt=""
                                      onError={(e) => { e.currentTarget.src = fallbackUserIcon; }}
                                    />
                                    <span class="ai-chip-popover-meta">
                                      <span class="ai-chip-popover-label">Contributor</span>
                                      <span class="ai-chip-popover-name">{creatorName}</span>
                                    </span>
                                  </span>
                                )}
                              </span>
                            ) : (
                              'Unknown'
                            )}
                          </td>
                          <td>{formatDate(item.history?.createdDate)}</td>
                          <td>{formatDate(item.version?.when)}</td>
                          {enableSummaries && (
                            <td>
                              <button
                                class="mini-ai-btn"
                                onClick={() => openAiSummaryModal(item)}
                                disabled={aiItemLoadingId === item.id}
                                title="AI Summary"
                                data-status={aiItemLoadingId === item.id ? 'loading' : (aiSummaryStatusById[item.id] || 'idle')}
                              >
                                {aiItemLoadingId === item.id
                                  ? 'Thinking...'
                                  : aiSummaryStatusById[item.id] === 'ready'
                                    ? 'Open'
                                    : 'Summarize'}
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )
            )}

            {loading && allResults.length > 0 && (
              <div class="loading-line loading-line-animated" role="status" aria-live="polite">
                <div class="loading-line-head">
                  <span>Loading more results</span>
                  <span class="typing-dots" aria-hidden="true">
                    <span class="dot" />
                    <span class="dot" />
                    <span class="dot" />
                  </span>
                </div>
              </div>
            )}
            {allLoaded && allResults.length > 0 && <div class="end-line">All results loaded.</div>}
          </div>
        </section>
      </main>

      <button
        class={`scroll-top ${showScrollTop ? 'show' : ''}`}
        onClick={() => scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
        title="Back to top"
      >↑</button>

      {treeTooltipData && (
        <div class="tree-tooltip-v2" ref={treeTooltipRef}>
          <div class="tree-tooltip-v2-head">
            <div class="tree-tooltip-v2-title-wrap">
              <div class="tree-tooltip-v2-kicker">
                <span aria-hidden="true">{typeIcons[treeTooltipData.type] || '📄'}</span>
                <span>{typeLabels[treeTooltipData.type] || treeTooltipData.type || 'Page'}</span>
              </div>
              <a class="tree-tooltip-v2-title" href={treeTooltipData.url} target="_blank" rel="noreferrer">
                {treeTooltipData.title}
              </a>
            </div>
          </div>
          <div class="tree-tooltip-v2-row">
            <img
              class="tree-tooltip-avatar"
              src={treeTooltipData.avatarUrl}
              alt=""
              onError={(e) => { e.currentTarget.src = fallbackUserIcon; }}
            />
            <div class="tree-tooltip-v2-meta">
              <div class="tree-tooltip-v2-label">Contributor</div>
              <div class="tree-tooltip-v2-value">{treeTooltipData.contributor}</div>
            </div>
          </div>
          <div class="tree-tooltip-v2-row">
            <img
              class="tree-tooltip-space-mini"
              src={treeTooltipData.spaceIconUrl}
              alt=""
              onError={(e) => { e.currentTarget.src = fallbackSpaceIcon; }}
            />
            <div class="tree-tooltip-v2-meta">
              <div class="tree-tooltip-v2-label">Space</div>
              <div class="tree-tooltip-v2-value">{treeTooltipData.spaceName}</div>
            </div>
          </div>
          <div class="tree-tooltip-v2-footer">Last modified: {treeTooltipData.modified}</div>
        </div>
      )}

      {aiModalOpen && (
        <div class="ai-modal-overlay" onClick={closeAiModal}>
          <div
            class="ai-modal panel"
            ref={aiModalRef}
            style={{
              width: `min(${aiModalWidth}px, calc(100vw - 24px))`,
              height: `min(${aiModalHeight}px, calc(100vh - 32px))`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              class="ai-modal-resizer ai-modal-resizer-left"
              onMouseDown={(e) => startAiModalResize(e, 'left')}
              onDblClick={resetAiModalWidth}
              title="Drag to resize (double-click to reset)"
            />
            <div
              class="ai-modal-resizer ai-modal-resizer-right"
              onMouseDown={(e) => startAiModalResize(e, 'right')}
              onDblClick={resetAiModalWidth}
              title="Drag to resize (double-click to reset)"
            />
            <div
              class="ai-modal-height-resizer ai-modal-height-resizer-top"
              onMouseDown={(e) => startAiModalHeightResize(e, 'top')}
              onDblClick={resetAiModalHeight}
              title="Drag to resize height (double-click to reset)"
            />
            <div
              class="ai-modal-height-resizer"
              onMouseDown={(e) => startAiModalHeightResize(e, 'bottom')}
              onDblClick={resetAiModalHeight}
              title="Drag to resize height (double-click to reset)"
            />
            <div class="ai-modal-head">
              <div class="ai-modal-title">
                <div class="ai-title-main">AI Summary Studio</div>
                {aiActiveItem && (
                  <a
                    href={buildConfluenceUrl(baseUrl, aiActiveItem._links?.webui)}
                    target="_blank"
                    rel="noreferrer"
                    title={aiActiveItem.title}
                  >
                    {aiActiveItem.title}
                  </a>
                )}
              </div>
              <button class="icon-btn" onClick={closeAiModal} title="Close">×</button>
            </div>

            {aiModalLoading ? (
              <div class="ai-loading-shell">
                <div class="ai-loading-spinner">
                  <span class="ring ring-a" />
                  <span class="ring ring-b" />
                  <span class="ring ring-c" />
                </div>
                <div class="ai-loading-title">Building your summary</div>
                <div class="ai-loading-subtitle">Reading page content, collecting context, and preparing Q&A.</div>
              </div>
            ) : (
              <div class="ai-modal-content">
                <div class="ai-meta-strip">
                  <span class="ai-chip">
                    <span class="ai-chip-glyph" aria-hidden="true">{typeIcons[aiActiveItem?.type] || '📄'}</span>
                    <span>Type: {aiActiveItem?.type || 'page'}</span>
                  </span>
                  <span class="ai-chip ai-chip-hoverable" tabIndex={0}>
                    <img
                      class="ai-chip-avatar"
                      src={aiSpaceIconSrc}
                      alt=""
                      onError={(e) => { e.currentTarget.src = fallbackSpaceIcon; }}
                    />
                    <span>Space: {aiActiveItem?.space?.name || 'N/A'}</span>
                    <span class="ai-chip-popover" role="tooltip" aria-hidden="true">
                      <img
                        class="ai-chip-popover-avatar"
                        src={aiSpaceIconSrc}
                        alt=""
                        onError={(e) => { e.currentTarget.src = fallbackSpaceIcon; }}
                      />
                      <span class="ai-chip-popover-meta">
                        <span class="ai-chip-popover-label">Space</span>
                        <span class="ai-chip-popover-name">{aiActiveItem?.space?.name || 'N/A'}</span>
                      </span>
                    </span>
                  </span>
                  <span class="ai-chip ai-chip-hoverable" tabIndex={0}>
                    <img
                      class="ai-chip-avatar"
                      src={aiContributorIconSrc}
                      alt=""
                      onError={(e) => { e.currentTarget.src = fallbackUserIcon; }}
                    />
                    <span>Contributor: {aiContributorName}</span>
                    <span class="ai-chip-popover ai-chip-popover-right" role="tooltip" aria-hidden="true">
                      <img
                        class="ai-chip-popover-avatar"
                        src={aiContributorIconSrc}
                        alt=""
                        onError={(e) => { e.currentTarget.src = fallbackUserIcon; }}
                      />
                      <span class="ai-chip-popover-meta">
                        <span class="ai-chip-popover-label">Contributor</span>
                        <span class="ai-chip-popover-name">{aiContributorName}</span>
                      </span>
                    </span>
                  </span>
                </div>

                <div
                  class={`ai-layout ${isAiSummaryCollapsed ? 'summary-collapsed' : ''} ${isAiChatCollapsed ? 'chat-collapsed' : ''}`.trim()}
                  ref={aiLayoutRef}
                  style={{ '--summary-width': `${Math.round(aiSummaryPaneRatio * 100)}%` }}
                >
                  <section class="ai-summary-panel">
                    <div class="ai-section-head">
                      <h3 class="ai-thread-title">Summary</h3>
                      <div class="ai-section-head-actions">
                        {!isAiSummaryCollapsed && (
                          <button
                            class="pane-toggle-btn pane-resummarize-btn"
                            onClick={resummarizeActiveItem}
                            disabled={aiSummaryRefreshing || aiAnswerLoading}
                          >
                            {aiSummaryRefreshing ? 'Refreshing...' : 'Re-summarize'}
                          </button>
                        )}
                        {isAiChatCollapsed && (
                          <button class="pane-toggle-btn" onClick={toggleChatPane}>Show chat</button>
                        )}
                        <button class="pane-toggle-btn" onClick={toggleSummaryPane}>Hide summary</button>
                      </div>
                    </div>
                    <section
                      class="ai-summary"
                      dir={aiSummaryDirection}
                      dangerouslySetInnerHTML={{ __html: aiSummaryHtml }}
                    />
                  </section>

                  {!isAiSummaryCollapsed && !isAiChatCollapsed && (
                    <div
                      class="ai-pane-resizer"
                      onMouseDown={startAiPaneResize}
                      onDblClick={resetAiSummaryPaneRatio}
                      title="Drag to resize summary and chat panes (double-click to reset)"
                    />
                  )}

                  <section class="ai-chat-panel">
                    <div class="ai-section-head">
                      <h3 class="ai-thread-title">Follow-up Questions</h3>
                      <div class="ai-section-head-actions">
                        <button
                          class="pane-toggle-btn pane-clear-btn"
                          onClick={clearAiConversation}
                          disabled={aiAnswerLoading || aiModalLoading}
                        >
                          Clear
                        </button>
                        {isAiSummaryCollapsed && (
                          <button class="pane-toggle-btn" onClick={toggleSummaryPane}>Show summary</button>
                        )}
                        <button class="pane-toggle-btn" onClick={toggleChatPane}>Hide chat</button>
                      </div>
                    </div>
                    <div class="ai-thread" ref={aiThreadRef}>
                      {aiConversation.slice(3).map((msg, idx) => (
                        msg.role === 'assistant' ? (
                          <div
                            key={`${msg.role}-${idx}`}
                            class="qa-entry assistant"
                            dir={detectDirectionFromHtml(msg.content)}
                            dangerouslySetInnerHTML={{ __html: sanitizeHtmlFragment(msg.content) }}
                          />
                        ) : (
                          <div key={`${msg.role}-${idx}`} class="qa-entry user" dir={detectDirection(msg.content)}>
                            {msg.content}
                          </div>
                        )
                      ))}
                      {aiAnswerLoading && (
                        <div class="qa-entry assistant typing-bubble">
                          <span class="typing-label">Thinking</span>
                          <span class="typing-dots">
                            <span class="dot" />
                            <span class="dot" />
                            <span class="dot" />
                          </span>
                        </div>
                      )}
                    </div>

                    <div class="ai-input-area">
                      <div
                        class="ai-question-resize-handle"
                        onMouseDown={startAiQuestionInputResize}
                        onDblClick={resetAiQuestionInputHeight}
                        title="Drag to resize question input (double-click to reset)"
                      />
                      <div class="ai-question-row">
                        <textarea
                          ref={aiQuestionInputRef}
                          dir="auto"
                          value={aiQuestion}
                          onInput={(e) => setAiQuestion(e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              submitAiQuestion();
                            }
                          }}
                          placeholder="Ask a follow-up question..."
                          style={{ height: `${aiQuestionInputHeight}px` }}
                        />
                        <button
                          class="btn ai-action-btn ask compact"
                          style={{ height: `${aiQuestionInputHeight}px` }}
                          onClick={submitAiQuestion}
                          disabled={aiAnswerLoading || aiModalLoading}
                        >
                          {aiAnswerLoading ? 'Thinking...' : 'Ask'}
                        </button>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {savedModalOpen && (
        <div class="saved-modal-overlay" onClick={() => setSavedModalOpen(false)}>
          <div class="saved-modal" onClick={(e) => e.stopPropagation()}>
            <div class="saved-modal-head">
              <h2>Saved Searches</h2>
              <button class="icon-btn" onClick={() => setSavedModalOpen(false)} title="Close">×</button>
            </div>

            <div class="saved-modal-toolbar">
              <input
                value={savedSearchQuery}
                onInput={(e) => setSavedSearchQuery(e.currentTarget.value)}
                placeholder="Filter saved searches..."
              />
              <button class="btn danger" onClick={removeAllSavedSearches}>Clear All</button>
            </div>

            <div class="saved-modal-list">
              {savedSearchesFiltered.length === 0 ? (
                <div class="empty">No saved searches.</div>
              ) : (
                savedSearchesFiltered.map((entry) => (
                  <article class="saved-entry" key={entry.id}>
                    {(() => {
                      const visuals = savedSearchVisualsById[entry.id] || {};
                      const spaceIconSrc = visuals.spaceIconUrl || fallbackSpaceIcon;
                      const contributorIconSrc = visuals.contributorIconUrl || fallbackUserIcon;
                      return (
                        <>
                    <div class="saved-entry-main">
                      <aside class="saved-entry-left">
                        <div class="saved-entry-icon-row">
                          <img
                            class="saved-entry-icon-large"
                            src={spaceIconSrc}
                            alt=""
                            onError={(e) => { e.currentTarget.src = fallbackSpaceIcon; }}
                          />
                          <div>
                            <div class="saved-entry-left-label">Space</div>
                            <div class="saved-entry-left-value">{entry.filters?.space?.label || entry.filters?.space?.key || 'Any'}</div>
                          </div>
                        </div>
                        <div class="saved-entry-icon-row">
                          <img
                            class="saved-entry-icon-large"
                            src={contributorIconSrc}
                            alt=""
                            onError={(e) => { e.currentTarget.src = fallbackUserIcon; }}
                          />
                          <div>
                            <div class="saved-entry-left-label">Contributor</div>
                            <div class="saved-entry-left-value">{entry.filters?.contributor?.label || entry.filters?.contributor?.key || 'Any'}</div>
                          </div>
                        </div>
                      </aside>
                      <section class="saved-entry-right">
                        <div class="saved-entry-title">{entry.name}</div>
                        <div class="saved-entry-grid">
                          <div class="saved-entry-meta"><strong>Search:</strong> {entry.searchText || 'N/A'}</div>
                          <div class="saved-entry-meta"><strong>Text:</strong> {entry.filters?.text?.label || entry.filters?.text?.key || 'Any'}</div>
                          <div class="saved-entry-meta"><strong>Date Filter:</strong> {entry.filters?.date || 'any'}</div>
                          <div class="saved-entry-meta"><strong>Type:</strong> {entry.filters?.type || 'Any'}</div>
                          <div class="saved-entry-meta"><strong>Saved:</strong> {formatDate(entry.createdAt)}</div>
                          <div class="saved-entry-meta"><strong>Modified:</strong> {formatDate(entry.updatedAt || entry.createdAt)}</div>
                        </div>
                      </section>
                    </div>
                    <div class="saved-entry-actions">
                      <button class="btn secondary" onClick={() => runSavedSearch(entry)}>Run</button>
                      <button class="btn secondary" onClick={() => renameSavedSearch(entry)}>Rename</button>
                      <button class="btn danger" onClick={() => removeSavedSearch(entry)}>Delete</button>
                    </div>
                        </>
                      );
                    })()}
                  </article>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {saveNameDialog.open && (
        <div class="name-dialog-overlay" onClick={() => closeSaveNameDialog(null)}>
          <div class="name-dialog" onClick={(e) => e.stopPropagation()}>
            <div class="name-dialog-head">
              <h3>{saveNameDialog.title}</h3>
            </div>
            <div class="name-dialog-body">
              <label for="save-name-input">Name</label>
              <input
                id="save-name-input"
                ref={saveNameDialogInputRef}
                value={saveNameDialog.value}
                onInput={(e) => setSaveNameDialog((prev) => ({ ...prev, value: e.currentTarget.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSaveNameDialogSubmit();
                  }
                }}
                placeholder={saveNameDialog.placeholder}
              />
            </div>
            <div class="name-dialog-actions">
              <button class="btn secondary" onClick={() => closeSaveNameDialog(null)}>Cancel</button>
              <button class="btn" onClick={handleSaveNameDialogSubmit}>{saveNameDialog.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog.open && (
        <div class="confirm-dialog-overlay" onClick={() => closeConfirmDialog(false)}>
          <div class="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div class="confirm-dialog-head">
              <h3>{confirmDialog.title}</h3>
            </div>
            <div class="confirm-dialog-body">
              <p>{confirmDialog.message}</p>
            </div>
            <div class="confirm-dialog-actions">
              <button class="btn secondary" onClick={() => closeConfirmDialog(false)}>Cancel</button>
              <button
                class={`btn ${confirmDialog.danger ? 'danger' : ''}`}
                onClick={() => closeConfirmDialog(true)}
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {noticeDialog.open && (
        <div class="notice-dialog-overlay" onClick={closeNoticeDialog}>
          <div class={`notice-dialog ${noticeDialog.tone}`} onClick={(e) => e.stopPropagation()}>
            <div class="notice-dialog-head">
              <h3>{noticeDialog.title}</h3>
            </div>
            <div class="notice-dialog-body">
              <p>{noticeDialog.message}</p>
            </div>
            <div class="notice-dialog-actions">
              <button class="btn" onClick={closeNoticeDialog}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
