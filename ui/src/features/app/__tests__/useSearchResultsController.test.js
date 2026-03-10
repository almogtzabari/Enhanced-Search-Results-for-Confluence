import { describe, expect, it, vi } from 'vitest';
import { mountHook } from '../../../test/hookTestUtils.js';
import { useSearchResultsController } from '../controllers/useSearchResultsController.js';

describe('useSearchResultsController', () => {
  it('aborts stale fetch when signature changes', async () => {
    const signals = [];

    global.fetch = vi.fn((url, options = {}) => {
      signals.push(options.signal);
      return new Promise((resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          const err = new Error('AbortError');
          err.name = 'AbortError';
          reject(err);
        });

        setTimeout(() => {
          resolve({
            ok: true,
            json: async () => ({ results: [], totalSize: 0 }),
            status: 200,
            statusText: 'OK',
          });
        }, 30);
      });
    });

    const hook = mountHook(useSearchResultsController, {
      params: {
        baseUrl: 'https://example.atlassian.net/wiki',
        searchText: 'alpha',
      },
      resultsPerRequest: 10,
      enableSummaries: true,
      openNoticeDialog: vi.fn(),
    });

    await hook.flush();
    hook.result.actions.updateFilterType('page');
    await hook.flush();

    expect(global.fetch).toHaveBeenCalled();
    expect(signals[0]?.aborted).toBe(true);
    hook.unmount();
  });
});
