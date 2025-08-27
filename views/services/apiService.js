// =========================================================
//                      API FUNCTIONS
// =========================================================
import { log } from '../config.js';
import { baseUrl, confluenceBodyCache } from '../state.js';

export async function fetchConfluenceBodyById(contentId, forceBodyFetch = false) {
    if (confluenceBodyCache.has(contentId) && !forceBodyFetch) {
        log.debug(`[Cache] Hit: Returning body for ${contentId}`);
        return confluenceBodyCache.get(contentId);
    }
    const apiUrl = `${baseUrl}/rest/api/content/${contentId}?expand=body.storage`;
    try {
        const response = await fetch(apiUrl, { method: 'GET', headers: { 'Accept': 'application/json' }, credentials: 'include' });
        if (!response.ok) throw new Error(`Workspace failed: ${response.statusText}`);
        const data = await response.json();
        const bodyHtml = data.body?.storage?.value || '(No content)';
        confluenceBodyCache.set(contentId, bodyHtml);
        log.debug(`[Cache] ${forceBodyFetch ? 'Forced ' : ''}Miss: Cached body for ${contentId}`);
        return bodyHtml;
    } catch (error) {
        log.error('[API] Error in fetchConfluenceBodyById:', error);
        throw error;
    }
}

export async function sendOpenAIRequest({ apiKey, apiUrl, model, messages }) {
    log.info('[OpenAI] (via BG) → POST', apiUrl);
    log.debug('[OpenAI] Payload:', { model, msgCount: messages.length });

    return new Promise((resolve, reject) => {
        const sanitizedBase = (apiUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const fullUrl = `${sanitizedBase}/chat/completions`;
        chrome.runtime.sendMessage(
            {
                type: 'openaiRequest',
                payload: { apiKey, apiUrl: fullUrl, model, messages }
            },
            (response) => {
                if (chrome.runtime.lastError) {
                    return reject(new Error(chrome.runtime.lastError.message));
                }
                if (!response?.success) {
                    return reject(new Error(response?.error || 'Unknown error from background'));
                }
                resolve(response.data);
            }
        );
    });
}

/**
 * Search spaces by query (Server/DC friendly).
 * Strategy:
 * 1) Try CQL for spaces (many Server/DC versions support it).
 * 2) Fallback to /rest/api/space and filter client-side.
 * Returns: [{ key, name, iconUrl }]
 */
export async function searchSpacesByQuery(query, limit = 10) {
    const q = (query || '').trim();
    if (!q) return [];
    // Attempt 1: CQL (type=space) — returns space results with icon in expand
    const cqlUrl = `${baseUrl}/rest/api/search?cql=${encodeURIComponent(`type=space AND title ~ "${q}"`)}&limit=${limit}&expand=space.icon`;
    try {
        const res = await fetch(cqlUrl, { credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            const results = (data.results || []).map(s => {
                const key = s.space?.key || s.key || '';
                const name = s.space?.name || s.name || '';
                const iconPath = s.space?.icon?.path || s.icon?.path || '';
                return {
                    key,
                    name,
                    iconUrl: iconPath ? `${baseUrl}${iconPath}` : `${baseUrl}/images/logo/default-space-logo.svg`
                };
            }).filter(s => s.key && s.name);
            if (results.length) return dedupeByKey(results, 'key');
        }
    } catch (err) {
        log.warn('[Spaces] CQL search for spaces failed, will try fallback:', err);
    }
}

export async function searchUsersByQuery(query, limit = 10) {
    const escapeCql = (s = '') => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const cql = `type=user AND user ~ "${escapeCql(query)}*"`;
    const cqlUrl = `${baseUrl}/rest/api/search?cql=${encodeURIComponent(cql)}&limit=${limit}&expand=icon`;
    try {
        const res = await fetch(cqlUrl, { credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            const results = (data.results || []).map(s => {
                const u = s.user || {};
                const key = u.username || u.userKey || u.accountId;
                const username = u.username || '';
                const displayName = u.displayName || username || key;
                const iconPath = u.profilePicture?.path || '';
                return {
                    key,
                    username,
                    displayName,
                    label: displayName, // common alias for UI components
                    value: username,    // common alias for UI components
                    avatarUrl: iconPath
                        ? (iconPath.startsWith('http') ? iconPath : `${baseUrl}${iconPath}`)
                        : `${baseUrl}/images/icons/profilepics/default.png`
                };
            }).filter(u => u.key && u.username);
            if (results.length) return dedupeByKey(results, 'key');
        }
    } catch (err) {
        log.warn('[Users] CQL search for users failed, will try fallback:', err);
    }

    return [];
}

/** Utility: de-duplicate objects by a key */
function dedupeByKey(list, key) {
    const seen = new Set();
    const out = [];
    for (const item of list) {
        const k = item[key];
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(item);
    }
    return out;
}
