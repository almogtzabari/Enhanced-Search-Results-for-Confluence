import { getChrome } from './storage.js';

function supportsDynamicOriginPermissionRequests(api) {
  if (!api?.permissions?.request || !api?.permissions?.contains) return false;
  const manifest = api.runtime?.getManifest?.();
  if (!manifest || typeof manifest !== 'object') return false;
  const mv = Number(manifest.manifest_version || 0);
  return mv >= 3 && Array.isArray(manifest.optional_host_permissions);
}

export const requestOriginsPermission = async (origins) => new Promise((resolve) => {
  const api = getChrome();
  if (!supportsDynamicOriginPermissionRequests(api)) {
    resolve({ granted: true, reason: 'not_required' });
    return;
  }
  api.permissions.request({ origins }, (granted) => {
    if (!granted) {
      resolve({ granted: false, reason: 'user_denied' });
      return;
    }

    api.permissions.contains({ origins }, (hasPermission) => {
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
