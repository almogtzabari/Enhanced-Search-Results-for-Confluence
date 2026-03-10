export function getQueryParams() {
  const url = new URL(window.location.href);
  return Object.fromEntries(url.searchParams.entries());
}

export function updateUrlParams(patch) {
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

export function resolveConfluenceIconUrl(baseUrl, maybePath, fallback) {
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

export function buildConfluenceUrl(baseUrl, webui) {
  if (!webui) return '#';
  if (/^https?:\/\//i.test(webui)) return webui;
  return new URL(webui, baseUrl).toString();
}

export function resolveOrigin(value) {
  try {
    return new URL(String(value || ''), window.location.href).origin;
  } catch {
    return '';
  }
}
