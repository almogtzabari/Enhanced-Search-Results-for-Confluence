import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearAllSavedSearches,
  deleteSavedSearch,
  getAllSavedSearches,
  getStoredConversation,
  getStoredSummary,
  storeConversation,
  storeSavedSearch,
  storeSummary,
} from '../dbClient.js';
import {
  CONVERSATION_STORE,
  SAVED_SEARCH_STORE,
  SUMMARY_STORE,
} from '../../shared/constants.js';

function createChromeRuntime(sendMessageImpl) {
  return {
    runtime: {
      lastError: null,
      sendMessage: vi.fn(sendMessageImpl),
    },
  };
}

describe('dbClient service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete global.chrome;
  });

  it('sends expected payload for saved search actions', async () => {
    global.chrome = createChromeRuntime((payload, callback) => callback({ success: true, result: payload }));

    const all = await getAllSavedSearches();
    const saved = await storeSavedSearch({ id: 's1' });
    const removed = await deleteSavedSearch('s1');
    const cleared = await clearAllSavedSearches();

    expect(all.store).toBe(SAVED_SEARCH_STORE);
    expect(all.mode).toBe('readonly');
    expect(all.op).toBe('getAll');
    expect(saved.op).toBe('put');
    expect(saved.payload).toEqual({ id: 's1' });
    expect(removed.op).toBe('delete');
    expect(removed.payload).toBe('s1');
    expect(cleared.op).toBe('clear');
  });

  it('sends expected payload for summary and conversation actions', async () => {
    global.chrome = createChromeRuntime((payload, callback) => callback({ success: true, result: payload }));
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

    const summaryLookup = await getStoredSummary('10', 'https://example.atlassian.net/wiki');
    const summaryStore = await storeSummary({ contentId: '10', baseUrl: 'b', summaryHtml: '<p>x</p>' });
    const conversationLookup = await getStoredConversation('11', 'https://example.atlassian.net/wiki');
    const conversationStore = await storeConversation('11', 'https://example.atlassian.net/wiki', [{ role: 'user', content: 'q' }]);

    expect(summaryLookup.store).toBe(SUMMARY_STORE);
    expect(summaryLookup.payload).toEqual(['10', 'https://example.atlassian.net/wiki']);
    expect(summaryStore.op).toBe('put');
    expect(conversationLookup.store).toBe(CONVERSATION_STORE);
    expect(conversationLookup.payload).toEqual(['11', 'https://example.atlassian.net/wiki']);
    expect(conversationStore.payload).toEqual({
      contentId: '11',
      baseUrl: 'https://example.atlassian.net/wiki',
      messages: [{ role: 'user', content: 'q' }],
      timestamp: 1700000000000,
    });
  });

  it('rejects when runtime.lastError is set', async () => {
    global.chrome = createChromeRuntime((_payload, callback) => {
      global.chrome.runtime.lastError = { message: 'runtime failed' };
      callback(undefined);
      global.chrome.runtime.lastError = null;
    });

    await expect(getAllSavedSearches()).rejects.toThrow('runtime failed');
  });

  it('rejects when db response indicates failure', async () => {
    global.chrome = createChromeRuntime((_payload, callback) => {
      callback({ success: false, error: 'db failed' });
    });

    await expect(getStoredSummary('1', 'b')).rejects.toThrow('db failed');
  });
});
