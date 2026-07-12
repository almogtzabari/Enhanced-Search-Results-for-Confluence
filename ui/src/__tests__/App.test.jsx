import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({
  storageListener: null,
  topBarProps: null,
  aiHookArgs: null,
}));

const storageServiceMocks = vi.hoisted(() => ({
  getSync: vi.fn(),
  setSync: vi.fn(),
  subscribeStorageChanges: vi.fn(),
  unsubscribe: vi.fn(),
}));

const controllerMocks = vi.hoisted(() => ({
  useSearchResultsController: vi.fn(),
  useAiSummaryController: vi.fn(),
  useSavedSearchesController: vi.fn(),
}));

vi.mock('../services/storage.js', () => ({
  getSync: storageServiceMocks.getSync,
  setSync: storageServiceMocks.setSync,
  subscribeStorageChanges: storageServiceMocks.subscribeStorageChanges,
}));

vi.mock('../features/app/controllers/useSearchResultsController.js', () => ({
  useSearchResultsController: controllerMocks.useSearchResultsController,
}));

vi.mock('../features/app/controllers/useAiSummaryController.js', () => ({
  useAiSummaryController: controllerMocks.useAiSummaryController,
}));

vi.mock('../features/app/controllers/useSavedSearchesController.js', () => ({
  useSavedSearchesController: controllerMocks.useSavedSearchesController,
}));

vi.mock('../features/app/components/TopBarSearch.jsx', () => ({
  TopBarSearch: (props) => {
    captured.topBarProps = props;
    return h('div', { id: 'topbar-mock' }, [
      h('button', { id: 'toggle-dark', onClick: props.toggleDarkMode }, 'toggle-dark'),
      h('button', { id: 'open-options', onClick: props.openOptions }, 'open-options'),
      h('span', { id: 'domain-name' }, props.domainName || ''),
    ]);
  },
}));

vi.mock('../features/app/components/SidebarPanel.jsx', () => ({
  SidebarPanel: () => h('div', { id: 'sidebar-mock' }, 'sidebar'),
}));

vi.mock('../features/app/components/ResultsPanel.jsx', () => ({
  ResultsPanel: () => h('div', { id: 'results-mock' }, 'results'),
}));

vi.mock('../features/app/components/TreeTooltip.jsx', () => ({
  TreeTooltip: () => h('div', { id: 'tooltip-mock' }, 'tooltip'),
}));

vi.mock('../components/AiModal.jsx', () => ({
  AiModal: () => h('div', { id: 'ai-modal-mock' }, 'ai-modal'),
}));

vi.mock('../components/SavedSearchModal.jsx', () => ({
  SavedSearchModal: () => h('div', { id: 'saved-searches-mock' }, 'saved-searches'),
}));

vi.mock('../components/Dialogs.jsx', () => ({
  ConfirmDialog: ({ open, dialog }) => (open ? h('div', { id: 'confirm-dialog' }, dialog?.title || '') : null),
  NoticeDialog: ({ open, dialog }) => (open ? h('div', { id: 'notice-dialog' }, dialog?.title || '') : null),
  SaveNameDialog: () => null,
}));

function createSearchController() {
  return {
    state: {
      baseUrl: 'https://example.atlassian.net/wiki',
      domainName: 'example.atlassian.net',
      searchInputAttention: false,
      searchInput: 'alpha',
      view: 'tree',
      filterText: '',
      filterSpace: '',
      spaceInput: '',
      selectedSpaceIcon: '',
      spaceDropdownOpen: false,
      spaceLookupLoading: false,
      spaceSuggestions: [],
      spaceActiveIndex: -1,
      filterContributor: '',
      selectedContributorIcon: '',
      contributorInput: '',
      contributorDropdownOpen: false,
      contributorLookupLoading: false,
      contributorSuggestions: [],
      contributorActiveIndex: -1,
      filterDate: 'any',
      filterType: '',
      loading: false,
      totalSize: 0,
      lastFetchAt: null,
      showScrollTop: false,
      collapsedNodes: new Set(),
      tableColWidths: {},
      tableSort: { key: '', direction: 'asc' },
      isInitialSearching: false,
      searchText: 'alpha',
      allLoaded: true,
    },
    derived: {
      allResults: [],
      filteredResults: [],
      spaceOptions: [],
      contributorOptions: [],
      treeRoots: [],
      tableColumns: [],
      tableResults: [],
      tableMinWidth: 0,
    },
    refs: {
      searchInputRef: { current: null },
      scrollerRef: { current: null },
      spaceBoxRef: { current: null },
      contributorBoxRef: { current: null },
      treeTooltipRef: { current: null },
    },
    actions: {
      setSearchInput: vi.fn(),
      runSearch: vi.fn(),
      setView: vi.fn(),
      handleTreeViewClick: vi.fn(),
      saveCurrentSearch: vi.fn(),
      openSavedSearches: vi.fn(),
      setFilterText: vi.fn(),
      setSpaceInput: vi.fn(),
      setFilterSpace: vi.fn(),
      setSpaceDropdownOpen: vi.fn(),
      setSpaceActiveIndex: vi.fn(),
      handleSpaceInputKeyDown: vi.fn(),
      applySpaceFilter: vi.fn(),
      setContributorInput: vi.fn(),
      setFilterContributor: vi.fn(),
      setContributorDropdownOpen: vi.fn(),
      setContributorActiveIndex: vi.fn(),
      handleContributorInputKeyDown: vi.fn(),
      applyContributorFilter: vi.fn(),
      updateFilterDate: vi.fn(),
      updateFilterType: vi.fn(),
      toggleNode: vi.fn(),
      showTreeTooltip: vi.fn(),
      moveTreeTooltip: vi.fn(),
      hideTreeTooltip: vi.fn(),
      toggleTableSort: vi.fn(),
      startTableColumnResize: vi.fn(),
      resetTableColumnWidth: vi.fn(),
      scrollToTop: vi.fn(),
      setTreeTooltipData: vi.fn(),
      applySavedSearchEntry: vi.fn(() => true),
    },
  };
}

function createAiController() {
  return {
    state: {
      aiModalOpen: false,
      aiModalLoading: false,
      aiModalLoadingTitle: 'Building your summary',
      aiModalWidth: 900,
      aiModalHeight: 620,
      aiActiveItem: null,
      aiBaseUrl: 'https://example.atlassian.net/wiki',
      aiSpaceIconSrc: '',
      aiContributorIconSrc: '',
      aiContributorName: '',
      isAiSummaryCollapsed: false,
      isAiChatCollapsed: false,
      aiSummaryPaneRatio: 0.6,
      aiSummaryRefreshing: false,
      aiAnswerLoading: false,
      aiSummaryDirection: 'ltr',
      aiSummaryHtml: '',
      aiConversation: [],
      aiQuestion: '',
      aiQuestionInputHeight: 120,
      aiSummaryFontSize: 15,
      aiChatFontSize: 15,
      aiItemLoadingId: null,
      aiSummaryStatusById: {},
    },
    refs: {
      aiModalRef: { current: null },
      aiLayoutRef: { current: null },
      aiThreadRef: { current: null },
      aiQuestionInputRef: { current: null },
    },
    actions: {
      closeAiModal: vi.fn(),
      startAiModalResize: vi.fn(),
      resetAiModalWidth: vi.fn(),
      startAiModalHeightResize: vi.fn(),
      resetAiModalHeight: vi.fn(),
      resummarizeActiveItem: vi.fn(),
      adjustAiSummaryFontSize: vi.fn(),
      toggleChatPane: vi.fn(),
      toggleSummaryPane: vi.fn(),
      startAiPaneResize: vi.fn(),
      resetAiSummaryPaneRatio: vi.fn(),
      clearAiConversation: vi.fn(),
      adjustAiChatFontSize: vi.fn(),
      startAiQuestionInputResize: vi.fn(),
      resetAiQuestionInputHeight: vi.fn(),
      setAiQuestion: vi.fn(),
      submitAiQuestion: vi.fn(),
      openAiSummaryModal: vi.fn(),
    },
  };
}

function createSavedController() {
  return {
    state: {
      savedModalOpen: false,
      savedSearchQuery: '',
      savedSearchesFiltered: [],
      savedSearchVisualsById: {},
      saveNameDialog: { open: false, value: '' },
    },
    refs: {
      saveNameDialogInputRef: { current: null },
    },
    actions: {
      setSavedModalOpen: vi.fn(),
      setSavedSearchQuery: vi.fn(),
      removeAllSavedSearches: vi.fn(),
      runSavedSearch: vi.fn(),
      renameSavedSearch: vi.fn(),
      removeSavedSearch: vi.fn(),
      closeSaveNameDialog: vi.fn(),
      setSaveNameDialog: vi.fn(),
      handleSaveNameDialogSubmit: vi.fn(),
      saveCurrentSearch: vi.fn(),
      openSavedSearches: vi.fn(),
    },
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('App', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    captured.storageListener = null;
    captured.topBarProps = null;
    captured.aiHookArgs = null;
    document.body.className = '';
    window.history.replaceState({}, '', '/views/index.html');
    delete global.chrome;

    storageServiceMocks.getSync.mockReset();
    storageServiceMocks.setSync.mockReset();
    storageServiceMocks.subscribeStorageChanges.mockReset();
    storageServiceMocks.unsubscribe.mockReset();
    controllerMocks.useSearchResultsController.mockReset();
    controllerMocks.useAiSummaryController.mockReset();
    controllerMocks.useSavedSearchesController.mockReset();

    storageServiceMocks.getSync.mockResolvedValue({});
    storageServiceMocks.setSync.mockResolvedValue({ ok: true, error: '' });
    storageServiceMocks.subscribeStorageChanges.mockImplementation((listener) => {
      captured.storageListener = listener;
      return storageServiceMocks.unsubscribe;
    });

    const searchController = createSearchController();
    const aiController = createAiController();
    const savedController = createSavedController();

    controllerMocks.useSearchResultsController.mockImplementation(() => searchController);
    controllerMocks.useAiSummaryController.mockImplementation((args) => {
      captured.aiHookArgs = args;
      return aiController;
    });
    controllerMocks.useSavedSearchesController.mockImplementation(() => savedController);
  });

  it('matches the content-page theme by default and falls back to the extension theme when disabled', async () => {
    window.history.replaceState(
      {},
      '',
      '/views/index.html?mode=content-modal&contentId=10&baseUrl=https%3A%2F%2Fconfluence.example&hostTheme=light',
    );
    const searchController = createSearchController();
    controllerMocks.useSearchResultsController.mockImplementation(() => searchController);

    storageServiceMocks.getSync.mockResolvedValue({
      darkMode: true,
      resultsPerRequest: 50,
      enableSummaries: false,
      selectedAiModel: 'gpt-4o',
      highlightResultRows: false,
      showTooltips: false,
    });

    const { App } = await import('../App.jsx');
    const container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      render(h(App, {}), container);
    });
    await flush();
    await flush();

    expect(document.body.classList.contains('modal-only-frame')).toBe(true);
    expect(document.body.classList.contains('dark-mode')).toBe(false);
    expect(searchController.actions.setTreeTooltipData).toHaveBeenCalledWith(null);
    expect(storageServiceMocks.setSync).toHaveBeenCalledWith({ selectedAiModel: 'gpt-5.6-terra' });

    const lastSearchCall = controllerMocks.useSearchResultsController.mock.calls.at(-1)[0];
    expect(lastSearchCall.resultsPerRequest).toBe(50);
    expect(lastSearchCall.enableSummaries).toBe(false);

    act(() => {
      captured.storageListener?.(
        {
          syncThemeToConfluencePage: { newValue: false },
        },
        'sync',
      );
    });

    expect(document.body.classList.contains('dark-mode')).toBe(true);

    act(() => {
      render(null, container);
    });
    container.remove();
    expect(storageServiceMocks.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('toggles dark mode and opens options page from top bar actions', async () => {
    global.chrome = {
      runtime: {
        openOptionsPage: vi.fn(),
      },
    };

    const { App } = await import('../App.jsx');
    const container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      render(h(App, {}), container);
    });
    await flush();

    await act(async () => {
      document.getElementById('toggle-dark').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(document.body.classList.contains('dark-mode')).toBe(true);
    expect(storageServiceMocks.setSync).toHaveBeenCalledWith({ darkMode: true });

    act(() => {
      document.getElementById('open-options').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(global.chrome.runtime.openOptionsPage).toHaveBeenCalledTimes(1);

    act(() => {
      render(null, container);
    });
    container.remove();
  });

  it('opens notice/confirm dialogs via controller callbacks and resolves confirm on Escape', async () => {
    const { App } = await import('../App.jsx');
    const container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      render(h(App, {}), container);
    });
    await flush();

    act(() => {
      captured.aiHookArgs.openNoticeDialog({
        title: 'Notice Title',
        message: 'Notice body',
        tone: 'error',
      });
    });
    expect(document.getElementById('notice-dialog')?.textContent).toContain('Notice Title');

    const confirmPromise = captured.aiHookArgs.openConfirmDialog({
      title: 'Confirm Title',
      message: 'Confirm body',
    });
    await flush();
    expect(document.getElementById('confirm-dialog')?.textContent).toContain('Confirm Title');

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await expect(confirmPromise).resolves.toBe(false);

    act(() => {
      render(null, container);
    });
    container.remove();
  });

  it('resolves pending confirm dialog promise when component unmounts', async () => {
    const { App } = await import('../App.jsx');
    const container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      render(h(App, {}), container);
    });
    await flush();

    const confirmPromise = captured.aiHookArgs.openConfirmDialog({
      title: 'Pending Confirm',
      message: 'Pending body',
    });

    act(() => {
      render(null, container);
    });
    container.remove();

    await expect(confirmPromise).resolves.toBe(false);
  });
});
