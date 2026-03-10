export const getChrome = () => globalThis.chrome;

export const getSync = (keys) => new Promise((resolve) => {
  const api = getChrome();
  if (!api?.storage?.sync?.get) {
    resolve({});
    return;
  }
  api.storage.sync.get(keys, resolve);
});

export const setSync = (payload) => new Promise((resolve) => {
  const api = getChrome();
  if (!api?.storage?.sync?.set) {
    resolve({ ok: false, error: 'Sync storage API unavailable' });
    return;
  }

  try {
    api.storage.sync.set(payload, () => {
      const error = api.runtime?.lastError?.message || '';
      if (error) {
        resolve({ ok: false, error });
        return;
      }
      resolve({ ok: true, error: '' });
    });
  } catch (err) {
    resolve({ ok: false, error: err?.message || 'Failed to write sync storage' });
  }
});

export const getLocal = (keys) => new Promise((resolve) => {
  const api = getChrome();
  if (!api?.storage?.local?.get) {
    resolve({});
    return;
  }
  api.storage.local.get(keys, resolve);
});

export const setLocal = (payload) => new Promise((resolve) => {
  const api = getChrome();
  if (!api?.storage?.local?.set) {
    resolve({ ok: false, error: 'Local storage API unavailable' });
    return;
  }

  try {
    api.storage.local.set(payload, () => {
      const error = api.runtime?.lastError?.message || '';
      if (error) {
        resolve({ ok: false, error });
        return;
      }
      resolve({ ok: true, error: '' });
    });
  } catch (err) {
    resolve({ ok: false, error: err?.message || 'Failed to write local storage' });
  }
});

export function subscribeStorageChanges(listener) {
  const api = getChrome();
  if (!api?.storage?.onChanged?.addListener) return () => {};
  api.storage.onChanged.addListener(listener);
  return () => {
    if (api?.storage?.onChanged?.removeListener) {
      api.storage.onChanged.removeListener(listener);
    }
  };
}
