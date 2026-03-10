import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountHook } from '../../../test/hookTestUtils.js';
import { useSavedSearchesController } from '../controllers/useSavedSearchesController.js';

const dbMocks = vi.hoisted(() => ({
  clearAllSavedSearches: vi.fn(async () => {}),
  deleteSavedSearch: vi.fn(async () => {}),
  getAllSavedSearches: vi.fn(async () => []),
  storeSavedSearch: vi.fn(async () => {}),
}));

vi.mock('../../../services/dbClient.js', () => ({
  clearAllSavedSearches: dbMocks.clearAllSavedSearches,
  deleteSavedSearch: dbMocks.deleteSavedSearch,
  getAllSavedSearches: dbMocks.getAllSavedSearches,
  storeSavedSearch: dbMocks.storeSavedSearch,
}));

function makeEntry(overrides = {}) {
  return {
    id: 's1',
    name: 'Search A',
    baseUrl: 'https://example.atlassian.net/wiki',
    searchText: 'alpha',
    filters: {
      text: { key: 'incident', label: 'Incident' },
      space: { key: 'ENG', label: 'Engineering' },
      contributor: { key: 'acct-1', label: 'Alice' },
      date: '1w',
      type: 'page',
    },
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  };
}

function createHook(overrides = {}) {
  return mountHook(useSavedSearchesController, {
    baseUrl: 'https://example.atlassian.net/wiki',
    searchText: 'alpha',
    filterText: 'incident',
    filterSpace: 'ENG',
    spaceInput: '',
    filterContributor: 'acct-1',
    contributorInput: '',
    filterDate: '1w',
    filterType: 'page',
    spaceOptions: [{ key: 'ENG', name: 'Engineering' }],
    contributorOptions: [{ key: 'acct-1', name: 'Alice' }],
    openNoticeDialog: vi.fn(),
    openConfirmDialog: vi.fn(async () => true),
    onRunSavedSearch: vi.fn(() => true),
    ...overrides,
  });
}

async function flushMany(hook, count = 5) {
  for (let i = 0; i < count; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await hook.flush();
  }
}

describe('useSavedSearchesController', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    dbMocks.clearAllSavedSearches.mockReset();
    dbMocks.deleteSavedSearch.mockReset();
    dbMocks.getAllSavedSearches.mockReset();
    dbMocks.storeSavedSearch.mockReset();
    dbMocks.clearAllSavedSearches.mockResolvedValue(undefined);
    dbMocks.deleteSavedSearch.mockResolvedValue(undefined);
    dbMocks.storeSavedSearch.mockResolvedValue(undefined);
    dbMocks.getAllSavedSearches.mockResolvedValue([
      makeEntry({ id: 's1', name: 'Search A', searchText: 'alpha', createdAt: 10 }),
      makeEntry({ id: 's2', name: 'Search B', searchText: 'infra', createdAt: 20 }),
    ]);
    global.fetch = vi.fn();
  });

  it('sorts by created time and filters by query across fields', async () => {
    const hook = createHook();
    await flushMany(hook, 2);

    expect(hook.result.state.savedSearchesFiltered.map((x) => x.id)).toEqual(['s2', 's1']);

    hook.result.actions.setSavedSearchQuery('incident');
    await hook.flush();
    expect(hook.result.state.savedSearchesFiltered.map((x) => x.id)).toEqual(['s2', 's1']);

    hook.result.actions.setSavedSearchQuery('infra');
    await hook.flush();
    expect(hook.result.state.savedSearchesFiltered.map((x) => x.id)).toEqual(['s2']);

    hook.result.actions.setSavedSearchQuery('no-match');
    await hook.flush();
    expect(hook.result.state.savedSearchesFiltered).toHaveLength(0);

    hook.unmount();
  });

  it('opens modal and closes after running a saved search when applied', async () => {
    const onRunSavedSearch = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const hook = createHook({ onRunSavedSearch });
    await flushMany(hook, 2);

    hook.result.actions.setSavedSearchQuery('x');
    await hook.flush();
    await hook.result.actions.openSavedSearches();
    await hook.flush();
    expect(hook.result.state.savedModalOpen).toBe(true);
    expect(hook.result.state.savedSearchQuery).toBe('');

    const entry = hook.result.state.savedSearchesFiltered[0];
    hook.result.actions.runSavedSearch(entry);
    expect(onRunSavedSearch).toHaveBeenCalledWith(entry);
    expect(hook.result.state.savedModalOpen).toBe(true);

    hook.result.actions.runSavedSearch(entry);
    await hook.flush();
    expect(hook.result.state.savedModalOpen).toBe(false);

    hook.unmount();
  });

  it('shows notice when trying to save without a search term', async () => {
    const openNoticeDialog = vi.fn();
    const hook = createHook({
      searchText: '   ',
      openNoticeDialog,
    });
    await flushMany(hook, 2);

    await hook.result.actions.saveCurrentSearch();
    expect(openNoticeDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Nothing to Save',
      tone: 'info',
    }));
    expect(dbMocks.storeSavedSearch).not.toHaveBeenCalled();

    hook.unmount();
  });

  it('saves current search from save-name dialog and ensures unique name', async () => {
    const openNoticeDialog = vi.fn();
    dbMocks.getAllSavedSearches.mockResolvedValue([
      makeEntry({ id: 's1', name: 'Search A', createdAt: 10 }),
      makeEntry({ id: 's2', name: 'Search A (1)', createdAt: 20 }),
    ]);
    vi.spyOn(Date, 'now').mockReturnValue(1700000001234);
    vi.spyOn(Math, 'random').mockReturnValue(0.123456);

    const hook = createHook({
      openNoticeDialog,
      searchText: '  production incident  ',
    });
    await flushMany(hook, 2);

    const savePromise = hook.result.actions.saveCurrentSearch();
    await hook.flush();
    expect(hook.result.state.saveNameDialog.open).toBe(true);

    hook.result.actions.setSaveNameDialog((prev) => ({ ...prev, value: 'Search A' }));
    await hook.flush();
    hook.result.actions.handleSaveNameDialogSubmit();
    await savePromise;
    await flushMany(hook, 2);

    expect(dbMocks.storeSavedSearch).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Search A (2)',
      searchText: 'production incident',
      baseUrl: 'https://example.atlassian.net/wiki',
      filters: expect.objectContaining({
        text: { key: 'incident', label: 'incident' },
        space: { key: 'ENG', label: 'Engineering' },
        contributor: { key: 'acct-1', label: 'Alice' },
        date: '1w',
        type: 'page',
      }),
      createdAt: 1700000001234,
      updatedAt: 1700000001234,
    }));
    expect(openNoticeDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Saved',
      tone: 'success',
    }));
    expect(hook.result.state.saveNameDialog.open).toBe(false);

    hook.unmount();
  });

  it('renames with validation, supports escape cancel, and can delete/clear saved searches', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const openNoticeDialog = vi.fn();
    const openConfirmDialog = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    const hook = createHook({ openNoticeDialog, openConfirmDialog });
    await flushMany(hook, 2);

    const target = hook.result.state.savedSearchesFiltered.find((entry) => entry.id === 's1');
    expect(target).toBeTruthy();

    const renameInvalidPromise = hook.result.actions.renameSavedSearch(target);
    await hook.flush();
    hook.result.actions.setSaveNameDialog((prev) => ({ ...prev, value: '   ' }));
    await hook.flush();
    hook.result.actions.handleSaveNameDialogSubmit();
    await renameInvalidPromise;
    expect(openNoticeDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Invalid Name',
      tone: 'info',
    }));

    const renameCancelPromise = hook.result.actions.renameSavedSearch(target);
    await hook.flush();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await renameCancelPromise;
    await hook.flush();
    expect(hook.result.state.saveNameDialog.open).toBe(false);

    vi.spyOn(Date, 'now').mockReturnValue(1700000009999);
    const renamePromise = hook.result.actions.renameSavedSearch(target);
    await hook.flush();
    hook.result.actions.setSaveNameDialog((prev) => ({ ...prev, value: 'Search B' }));
    await hook.flush();
    hook.result.actions.handleSaveNameDialogSubmit();
    await renamePromise;
    await hook.flush();
    expect(dbMocks.storeSavedSearch).toHaveBeenCalledWith(expect.objectContaining({
      id: 's1',
      name: 'Search B (1)',
      updatedAt: 1700000009999,
    }));

    await hook.result.actions.removeSavedSearch(target);
    expect(dbMocks.deleteSavedSearch).not.toHaveBeenCalled();

    await hook.result.actions.removeSavedSearch(target);
    expect(dbMocks.deleteSavedSearch).toHaveBeenCalledWith('s1');

    await hook.result.actions.removeAllSavedSearches();
    expect(dbMocks.clearAllSavedSearches).toHaveBeenCalledTimes(1);
    expect(hook.result.state.savedSearchesFiltered).toHaveLength(0);

    dbMocks.clearAllSavedSearches.mockRejectedValueOnce(new Error('clear failed'));
    await hook.result.actions.removeAllSavedSearches();
    expect(openNoticeDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Failed to Clear Saved Searches',
      message: 'clear failed',
      tone: 'error',
    }));

    hook.unmount();
  });

  it('loads saved-search visuals via Confluence APIs when modal is opened', async () => {
    dbMocks.getAllSavedSearches.mockResolvedValue([
      makeEntry({
        id: 'v1',
        baseUrl: 'https://example.atlassian.net/wiki',
        filters: {
          space: { key: 'ENG', label: 'Engineering' },
          contributor: { key: 'acct-1', label: 'Alice' },
          text: { key: '', label: '' },
          date: 'any',
          type: '',
        },
      }),
    ]);

    global.fetch = vi.fn(async (url) => {
      const href = String(url);
      if (href.includes('/rest/api/space/ENG?expand=icon')) {
        return { ok: true, json: async () => ({ icon: { path: '/icons/space.svg' } }) };
      }
      if (href.includes('/rest/api/user?accountId=acct-1')) {
        return { ok: true, json: async () => ({ profilePicture: { path: '/avatars/user.png' } }) };
      }
      return { ok: false, json: async () => ({}) };
    });

    const hook = createHook();
    await flushMany(hook, 2);
    hook.result.actions.setSavedModalOpen(true);
    await flushMany(hook, 5);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.atlassian.net/wiki/rest/api/space/ENG?expand=icon',
      { credentials: 'include' },
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.atlassian.net/wiki/rest/api/user?accountId=acct-1',
      { credentials: 'include' },
    );
    expect(hook.result.state.savedSearchVisualsById.v1).toEqual({
      spaceIconUrl: 'https://example.atlassian.net/icons/space.svg',
      contributorIconUrl: 'https://example.atlassian.net/avatars/user.png',
    });

    hook.unmount();
  });

  it('falls back to search-based visual lookup when direct lookups fail', async () => {
    dbMocks.getAllSavedSearches.mockResolvedValue([
      makeEntry({
        id: 'v2',
        baseUrl: 'https://example.atlassian.net/wiki',
        filters: {
          space: { key: 'ENG', label: 'Engineering Team' },
          contributor: { key: 'acct-2', label: 'Bob' },
          text: { key: '', label: '' },
          date: 'any',
          type: '',
        },
      }),
    ]);

    global.fetch = vi.fn(async (url) => {
      const href = String(url);
      if (href.includes('/rest/api/space/ENG?expand=icon')) {
        return { ok: false, json: async () => ({}) };
      }
      if (href.includes('/rest/api/search?cql=')) {
        return { ok: true, json: async () => ({ results: [{ space: { icon: { path: '/icons/search-space.svg' } } }] }) };
      }
      if (href.includes('/rest/api/user?accountId=acct-2')) {
        return { ok: false, json: async () => ({}) };
      }
      if (href.includes('/rest/api/user?username=acct-2')) {
        return { ok: false, json: async () => ({}) };
      }
      if (href.includes('/rest/api/user?key=acct-2')) {
        return { ok: false, json: async () => ({}) };
      }
      if (href.includes('/rest/api/user/search?username=Bob&limit=1')) {
        return { ok: true, json: async () => ([{ profilePicture: { path: '/avatars/list-user.png' } }]) };
      }
      return { ok: false, json: async () => ({}) };
    });

    const hook = createHook();
    await flushMany(hook, 2);
    hook.result.actions.setSavedModalOpen(true);
    await flushMany(hook, 6);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/rest/api/search?cql='),
      { credentials: 'include' },
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.atlassian.net/wiki/rest/api/user/search?username=Bob&limit=1',
      { credentials: 'include' },
    );
    expect(hook.result.state.savedSearchVisualsById.v2).toEqual({
      spaceIconUrl: 'https://example.atlassian.net/icons/search-space.svg',
      contributorIconUrl: 'https://example.atlassian.net/avatars/list-user.png',
    });

    hook.unmount();
  });
});
