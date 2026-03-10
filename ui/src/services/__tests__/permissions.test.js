import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  getChrome: vi.fn(),
}));

vi.mock('../storage.js', () => ({
  getChrome: storageMocks.getChrome,
}));

import { ensureApiOriginPermission, requestOriginsPermission } from '../permissions.js';

function createApi({
  manifestVersion = 3,
  optionalOrigins = ['https://*/*'],
  containsResult = true,
  requestResult = true,
  containsError = '',
  requestError = '',
  verifyResult = true,
  verifyError = '',
} = {}) {
  const api = {
    runtime: {
      lastError: null,
      getManifest: () => (
        manifestVersion >= 3
          ? { manifest_version: manifestVersion, optional_host_permissions: optionalOrigins }
          : { manifest_version: manifestVersion, optional_permissions: optionalOrigins }
      ),
    },
    permissions: {
      contains: vi.fn((_query, callback) => {
        if (containsError) {
          api.runtime.lastError = { message: containsError };
          callback(false);
          api.runtime.lastError = null;
          return;
        }
        callback(containsResult);
      }),
      request: vi.fn((_query, callback) => {
        if (requestError) {
          api.runtime.lastError = { message: requestError };
          callback(false);
          api.runtime.lastError = null;
          return;
        }
        callback(requestResult);
      }),
    },
  };

  // For verification phase in ensureApiOriginPermission (after request).
  let containsCallCount = 0;
  api.permissions.contains.mockImplementation((_query, callback) => {
    containsCallCount += 1;
    if (containsCallCount >= 2 && verifyError) {
      api.runtime.lastError = { message: verifyError };
      callback(false);
      api.runtime.lastError = null;
      return;
    }
    if (containsCallCount >= 2) {
      callback(verifyResult);
      return;
    }
    if (containsError) {
      api.runtime.lastError = { message: containsError };
      callback(false);
      api.runtime.lastError = null;
      return;
    }
    callback(containsResult);
  });

  return api;
}

describe('permissions service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    storageMocks.getChrome.mockReset();
  });

  it('returns not_required when dynamic permission requests are unsupported', async () => {
    storageMocks.getChrome.mockReturnValue({
      runtime: { getManifest: () => ({ manifest_version: 3, optional_host_permissions: [] }) },
      permissions: null,
    });

    const result = await requestOriginsPermission(['https://example.com/*']);
    expect(result).toEqual({ granted: true, reason: 'not_required' });
  });

  it('returns request_failed when browser request API sets runtime.lastError', async () => {
    storageMocks.getChrome.mockReturnValue(createApi({
      containsResult: false,
      requestError: 'Request failed',
    }));

    const result = await requestOriginsPermission(['https://example.com/*']);
    expect(result).toEqual({ granted: false, reason: 'request_failed' });
  });

  it('returns missing_permission when contains is false and requesting is disabled', async () => {
    storageMocks.getChrome.mockReturnValue(createApi({
      containsResult: false,
    }));

    const result = await ensureApiOriginPermission('https://example.com', { requestIfMissing: false });
    expect(result).toEqual({ granted: false, reason: 'missing_permission' });
  });

  it('returns granted true after request and verification succeed', async () => {
    storageMocks.getChrome.mockReturnValue(createApi({
      containsResult: false,
      requestResult: true,
      verifyResult: true,
    }));

    const result = await ensureApiOriginPermission('https://example.com');
    expect(result).toEqual({ granted: true, reason: '' });
  });

  it('returns contains_failed when verification step errors', async () => {
    storageMocks.getChrome.mockReturnValue(createApi({
      containsResult: false,
      requestResult: true,
      verifyError: 'verification exploded',
    }));

    const result = await ensureApiOriginPermission('https://example.com');
    expect(result).toEqual({ granted: false, reason: 'contains_failed' });
  });
});
