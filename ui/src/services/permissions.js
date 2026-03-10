import { getChrome } from './storage.js';

function hasOptionalOriginPermissions(entries) {
  if (!Array.isArray(entries)) return false;
  return entries.some((entry) => (
    typeof entry === 'string'
    && (entry === '<all_urls>' || entry.includes('://'))
  ));
}

function supportsDynamicOriginPermissionRequests(api) {
  if (!api?.permissions?.request || !api?.permissions?.contains) return false;
  const manifest = api.runtime?.getManifest?.();
  if (!manifest || typeof manifest !== 'object') return false;
  const mv = Number(manifest.manifest_version || 0);
  if (mv >= 3) {
    return hasOptionalOriginPermissions(manifest.optional_host_permissions);
  }
  return hasOptionalOriginPermissions(manifest.optional_permissions);
}

function getLastErrorMessage(api) {
  return api?.runtime?.lastError?.message || '';
}

export const requestOriginsPermission = async (origins) => new Promise((resolve) => {
  const api = getChrome();
  if (!supportsDynamicOriginPermissionRequests(api)) {
    resolve({ granted: true, reason: 'not_required' });
    return;
  }
  api.permissions.request({ origins }, (granted) => {
    const requestError = getLastErrorMessage(api);
    if (requestError) {
      resolve({ granted: false, reason: 'request_failed' });
      return;
    }
    if (!granted) {
      resolve({ granted: false, reason: 'user_denied' });
      return;
    }

    api.permissions.contains({ origins }, (hasPermission) => {
      const containsError = getLastErrorMessage(api);
      if (containsError) {
        resolve({ granted: false, reason: 'contains_failed' });
        return;
      }
      resolve({
        granted: !!hasPermission,
        reason: hasPermission ? '' : 'not_granted_after_request',
      });
    });
  });
});

export function ensureApiOriginPermission(origin, { requestIfMissing = true } = {}) {
  return new Promise((resolve) => {
    const api = getChrome();
    if (!supportsDynamicOriginPermissionRequests(api)) {
      resolve({ granted: true, reason: '' });
      return;
    }

    const originPattern = `${origin}/*`;
    api.permissions.contains({ origins: [originPattern] }, (hasPermission) => {
      const containsError = getLastErrorMessage(api);
      if (containsError) {
        resolve({ granted: false, reason: 'contains_failed' });
        return;
      }
      if (hasPermission) {
        resolve({ granted: true, reason: '' });
        return;
      }

      if (!requestIfMissing) {
        resolve({ granted: false, reason: 'missing_permission' });
        return;
      }

      api.permissions.request({ origins: [originPattern] }, (granted) => {
        const requestError = getLastErrorMessage(api);
        if (requestError) {
          resolve({ granted: false, reason: 'request_failed' });
          return;
        }
        if (!granted) {
          resolve({ granted: false, reason: 'user_denied' });
          return;
        }

        api.permissions.contains({ origins: [originPattern] }, (verified) => {
          const verifyError = getLastErrorMessage(api);
          if (verifyError) {
            resolve({ granted: false, reason: 'contains_failed' });
            return;
          }
          resolve({
            granted: !!verified,
            reason: verified ? '' : 'not_granted_after_request',
          });
        });
      });
    });
  });
}
