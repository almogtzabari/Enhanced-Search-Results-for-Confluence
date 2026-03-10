import { describe, expect, it, vi } from 'vitest';
import { mountHook } from '../../../test/hookTestUtils.js';
import { useSavedSearchesController } from '../controllers/useSavedSearchesController.js';

const dbMocks = vi.hoisted(() => ({
  clearAllSavedSearches: vi.fn(async () => {}),
  deleteSavedSearch: vi.fn(async () => {}),
  getAllSavedSearches: vi.fn(async () => ([
    {
      id: 's1',
      name: 'Search A',
      baseUrl: 'https://example.atlassian.net/wiki',
      searchText: 'alpha',
      filters: {},
      createdAt: 1,
    },
  ])),
  storeSavedSearch: vi.fn(async () => {}),
}));

vi.mock('../../../services/dbClient.js', () => ({
  clearAllSavedSearches: dbMocks.clearAllSavedSearches,
  deleteSavedSearch: dbMocks.deleteSavedSearch,
  getAllSavedSearches: dbMocks.getAllSavedSearches,
  storeSavedSearch: dbMocks.storeSavedSearch,
}));

describe('useSavedSearchesController', () => {
  it('deletes a saved search after confirmation', async () => {
    const hook = mountHook(useSavedSearchesController, {
      baseUrl: 'https://example.atlassian.net/wiki',
      searchText: 'alpha',
      filterText: '',
      filterSpace: '',
      spaceInput: '',
      filterContributor: '',
      contributorInput: '',
      filterDate: 'any',
      filterType: '',
      spaceOptions: [],
      contributorOptions: [],
      openNoticeDialog: vi.fn(),
      openConfirmDialog: vi.fn(async () => true),
      onRunSavedSearch: vi.fn(() => true),
    });

    await hook.flush();
    await hook.flush();

    const entry = hook.result.state.savedSearchesFiltered[0];
    await hook.result.actions.removeSavedSearch(entry);

    expect(dbMocks.deleteSavedSearch).toHaveBeenCalledWith('s1');
    hook.unmount();
  });
});
