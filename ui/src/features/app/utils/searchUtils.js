import { fallbackSpaceIcon, fallbackUserIcon } from '../constants.js';
import { resolveConfluenceIconUrl } from './urlUtils.js';

export function buildSearchSignature({
  baseUrl,
  searchText,
  filterType,
  filterDate,
  filterSpace,
  filterContributor,
  resultsPerRequest,
}) {
  return [
    String(baseUrl || '').trim(),
    String(searchText || '').trim(),
    String(filterType || ''),
    String(filterDate || ''),
    String(filterSpace || ''),
    String(filterContributor || ''),
    String(resultsPerRequest || ''),
  ].join('|');
}

export function dedupeByKey(list, key) {
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

export async function searchSpacesByQuery(baseUrl, query, limit = 10) {
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
          iconUrl: resolveConfluenceIconUrl(
            baseUrl,
            iconPath || '/images/logo/default-space-logo.svg',
            fallbackSpaceIcon,
          ),
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
        iconUrl: resolveConfluenceIconUrl(
          baseUrl,
          iconPath || '/images/logo/default-space-logo.svg',
          fallbackSpaceIcon,
        ),
      };
    }).filter((s) => s.key && s.name);
    return dedupeByKey(filtered, 'key').slice(0, limit);
  } catch {
    return [];
  }
}

export async function searchUsersByQuery(baseUrl, query, limit = 10) {
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
          avatarUrl: resolveConfluenceIconUrl(
            baseUrl,
            iconPath || '/images/icons/profilepics/default.png',
            fallbackUserIcon,
          ),
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
        avatarUrl: resolveConfluenceIconUrl(
          baseUrl,
          iconPath || '/images/icons/profilepics/default.png',
          fallbackUserIcon,
        ),
      };
    }).filter((u) => u.key && u.name);
    return dedupeByKey(results, 'key');
  } catch {
    return [];
  }
}

export function cqlFromState(searchText, filterType, filterDate, filterSpaceKey, filterContributorKey) {
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
