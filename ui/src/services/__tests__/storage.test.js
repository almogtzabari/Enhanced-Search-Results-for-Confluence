import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getChrome,
  getLocal,
  getSync,
  setLocal,
  setSync,
  subscribeStorageChanges,
} from '../storage.js';

describe('storage service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete global.chrome;
  });

  it('returns global chrome from getChrome', () => {
    global.chrome = { runtime: {} };
    expect(getChrome()).toBe(global.chrome);
  });

  it('returns empty object when sync storage API is unavailable', async () => {
    global.chrome = {};
    await expect(getSync(['k'])).resolves.toEqual({});
  });

  it('reads from sync storage when API exists', async () => {
    global.chrome = {
      storage: {
        sync: {
          get: vi.fn((_keys, callback) => callback({ a: 1 })),
        },
      },
    };

    await expect(getSync(['a'])).resolves.toEqual({ a: 1 });
  });

  it('setSync handles success, runtime error, and thrown error', async () => {
    global.chrome = {
      runtime: { lastError: null },
      storage: {
        sync: {
          set: vi.fn((payload, callback) => {
            if (payload.mode === 'throw') throw new Error('boom');
            if (payload.mode === 'runtimeError') {
              global.chrome.runtime.lastError = { message: 'write failed' };
            } else {
              global.chrome.runtime.lastError = null;
            }
            callback();
            global.chrome.runtime.lastError = null;
          }),
        },
      },
    };

    await expect(setSync({ mode: 'ok' })).resolves.toEqual({ ok: true, error: '' });
    await expect(setSync({ mode: 'runtimeError' })).resolves.toEqual({ ok: false, error: 'write failed' });
    await expect(setSync({ mode: 'throw' })).resolves.toEqual({ ok: false, error: 'boom' });
  });

  it('returns unavailable error when local storage set API is missing', async () => {
    global.chrome = { storage: { local: {} } };
    await expect(setLocal({ a: 1 })).resolves.toEqual({ ok: false, error: 'Local storage API unavailable' });
  });

  it('reads from local storage and writes successfully', async () => {
    global.chrome = {
      runtime: { lastError: null },
      storage: {
        local: {
          get: vi.fn((_keys, callback) => callback({ token: 'x' })),
          set: vi.fn((_payload, callback) => callback()),
        },
      },
    };

    await expect(getLocal(['token'])).resolves.toEqual({ token: 'x' });
    await expect(setLocal({ token: 'y' })).resolves.toEqual({ ok: true, error: '' });
  });

  it('subscribeStorageChanges registers and unregisters listeners', () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();
    const listener = vi.fn();

    global.chrome = {
      storage: {
        onChanged: {
          addListener,
          removeListener,
        },
      },
    };

    const unsubscribe = subscribeStorageChanges(listener);
    expect(addListener).toHaveBeenCalledWith(listener);
    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith(listener);
  });
});
