const confluenceBodyCache = new Map();
const confluenceUserCache = new Map();
let bridgeRequestCounter = 0;

function normalizeBaseForCacheKey(value) {
  return String(value || '').trim().replace(/\/+$/, '').toLowerCase();
}

function makeBodyCacheKey(baseUrl, contentId) {
  return `${normalizeBaseForCacheKey(baseUrl)}::${String(contentId || '').trim()}`;
}

function normalizeUserLookupValue(type, value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  return type === 'username' ? normalized.toLowerCase() : normalized;
}

function makeUserCacheKey(baseUrl, type, value) {
  const normalizedValue = normalizeUserLookupValue(type, value);
  if (!normalizedValue) return '';
  return `${normalizeBaseForCacheKey(baseUrl)}::${type}:${normalizedValue}`;
}

function extractMentionUserRef(node) {
  if (!node) return null;
  const accountId = node.getAttribute('ri:account-id') || node.getAttribute('ri:accountId') || '';
  const username = node.getAttribute('ri:username') || '';
  const userKey = node.getAttribute('ri:userkey') || node.getAttribute('ri:userKey') || '';
  if (!accountId && !username && !userKey) return null;
  return { accountId, username, userKey };
}

function makeMentionRefKey(ref) {
  return [
    normalizeUserLookupValue('accountId', ref?.accountId),
    normalizeUserLookupValue('username', ref?.username),
    normalizeUserLookupValue('userKey', ref?.userKey),
  ].join('|');
}

function resolveMentionLabel(userDetails, userRef) {
  const raw = String(
    userDetails?.displayName
      || userDetails?.publicName
      || userDetails?.fullName
      || userRef?.username
      || userRef?.userKey
      || userRef?.accountId
      || 'user',
  ).trim();
  const trimmed = raw.replace(/^@+/, '');
  return `@${trimmed || 'user'}`;
}

function buildMentionProfileHref(baseUrl, userDetails, userRef) {
  const root = `${String(baseUrl || window.location.origin).replace(/\/+$/, '')}/`;
  const accountId = String(userDetails?.accountId || userRef?.accountId || '').trim();
  if (accountId) {
    return new URL(`people/${encodeURIComponent(accountId)}`, root).toString();
  }
  const username = String(userDetails?.username || userDetails?.name || userRef?.username || '').trim();
  if (username) {
    return new URL(`display/~${encodeURIComponent(username)}`, root).toString();
  }
  return '';
}

function buildUserLookupEntries(user) {
  if (!user || typeof user !== 'object') return [];
  const accountId = String(user.accountId || '').trim();
  const username = String(user.username || '').trim();
  const userKey = String(user.userKey || '').trim();

  return [
    accountId ? { type: 'accountId', value: accountId, query: `accountId=${encodeURIComponent(accountId)}` } : null,
    username ? { type: 'username', value: username, query: `username=${encodeURIComponent(username)}` } : null,
    userKey ? { type: 'key', value: userKey, query: `key=${encodeURIComponent(userKey)}` } : null,
  ].filter(Boolean);
}

async function replaceConfluenceUserMentions(baseUrl, storageHtml) {
  const html = String(storageHtml || '');
  if (!html || !/ri:user/i.test(html)) return html;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const userNodes = [...doc.querySelectorAll('ri\\:user')];
  if (!userNodes.length) return html;

  const refsByKey = new Map();
  userNodes.forEach((node) => {
    const ref = extractMentionUserRef(node);
    if (!ref) return;
    const refKey = makeMentionRefKey(ref);
    if (!refsByKey.has(refKey)) refsByKey.set(refKey, ref);
  });

  const resolvedUsers = await Promise.all(
    [...refsByKey.entries()].map(async ([refKey, ref]) => {
      const details = await fetchUserDetails(baseUrl, ref);
      return [refKey, details];
    }),
  );
  const userByRefKey = new Map(resolvedUsers);
  const replacedContainers = new Set();

  userNodes.forEach((node) => {
    if (!node.isConnected) return;
    const ref = extractMentionUserRef(node);
    if (!ref) return;
    const refKey = makeMentionRefKey(ref);
    const userDetails = userByRefKey.get(refKey) || null;
    const label = resolveMentionLabel(userDetails, ref);
    const href = buildMentionProfileHref(baseUrl, userDetails, ref);
    const mentionEl = href ? doc.createElement('a') : doc.createElement('span');
    mentionEl.textContent = label;
    mentionEl.setAttribute('title', label);

    if (href) {
      mentionEl.setAttribute('href', href);
      mentionEl.setAttribute('target', '_blank');
      mentionEl.setAttribute('rel', 'noopener noreferrer');
    }

    const linkContainer = node.closest('ac\\:link');
    if (linkContainer && !replacedContainers.has(linkContainer)) {
      replacedContainers.add(linkContainer);
      linkContainer.replaceWith(mentionEl);
      return;
    }

    node.replaceWith(mentionEl);
  });

  return doc.body.innerHTML;
}

function buildBodyCacheKeys(baseUrl, contentId) {
  const id = String(contentId || '').trim();
  if (!id) return [];
  const keys = new Set([makeBodyCacheKey(baseUrl, id)]);
  const candidates = buildConfluenceBaseCandidates(baseUrl);
  candidates.forEach((candidate) => keys.add(makeBodyCacheKey(candidate, id)));
  return [...keys];
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

export function fetchImageDataUrlViaHostBridge(url, timeoutMs = 15000) {
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

export async function fetchConfluenceBodyById(baseUrl, contentId, {
  force = false,
  sanitizeHtmlFragment,
} = {}) {
  const cacheKeys = buildBodyCacheKeys(baseUrl, contentId);
  if (!force) {
    for (const key of cacheKeys) {
      if (confluenceBodyCache.has(key)) {
        return confluenceBodyCache.get(key);
      }
    }
  }

  const { data, resolvedBaseUrl } = await fetchConfluenceJsonWithFallback(
    baseUrl,
    `/rest/api/content/${contentId}?expand=body.storage`,
  );
  const sanitizer = typeof sanitizeHtmlFragment === 'function' ? sanitizeHtmlFragment : (value) => value;
  const storageHtml = data.body?.storage?.value || '(No content)';
  const mentionSafeHtml = await replaceConfluenceUserMentions(resolvedBaseUrl || baseUrl, storageHtml);
  const bodyHtml = sanitizer(mentionSafeHtml);
  const resolvedKeys = new Set(cacheKeys);
  resolvedKeys.add(makeBodyCacheKey(resolvedBaseUrl, contentId));
  resolvedKeys.forEach((key) => {
    confluenceBodyCache.set(key, bodyHtml);
  });
  return bodyHtml;
}

export async function fetchConfluenceMetadataById(baseUrl, contentId) {
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
  const lookups = buildUserLookupEntries(createdBy);
  if (!lookups.length) return null;

  for (const lookup of lookups) {
    const cacheKey = makeUserCacheKey(baseUrl, lookup.type, lookup.value);
    if (cacheKey && confluenceUserCache.has(cacheKey)) {
      return confluenceUserCache.get(cacheKey);
    }
  }

  for (const lookup of lookups) {
    try {
      const { data } = await fetchConfluenceJsonWithFallback(
        baseUrl,
        `/rest/api/user?${lookup.query}`,
      );
      if (data && typeof data === 'object') {
        lookups.forEach((entry) => {
          const cacheKey = makeUserCacheKey(baseUrl, entry.type, entry.value);
          if (cacheKey) confluenceUserCache.set(cacheKey, data);
        });
        return data;
      }
    } catch {
      // Try next query form
    }
  }

  return null;
}

export async function enrichVisualMetadata(baseUrl, pageData) {
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
