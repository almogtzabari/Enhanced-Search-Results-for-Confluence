import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountHook } from '../../../test/hookTestUtils.js';
import { DEFAULT_TABLE_COL_WIDTHS } from '../constants.js';
import { useSearchResultsController } from '../controllers/useSearchResultsController.js';

const urlUtilsMocks = vi.hoisted(() => ({
  updateUrlParams: vi.fn(),
}));

vi.mock('../utils/urlUtils.js', async () => {
  const actual = await vi.importActual('../utils/urlUtils.js');
  return {
    ...actual,
    updateUrlParams: urlUtilsMocks.updateUrlParams,
  };
});

function makeResult(overrides = {}) {
  const id = overrides.id || '1';
  return {
    id: String(id),
    title: overrides.title || `Page ${id}`,
    type: overrides.type || 'page',
    _links: { webui: `/pages/${id}` },
    space: {
      key: overrides.spaceKey || 'ENG',
      name: overrides.spaceName || 'Engineering',
      icon: { path: overrides.spaceIconPath || '/icons/space.svg' },
    },
    history: {
      createdBy: {
        accountId: overrides.contributorKey || 'acct-1',
        displayName: overrides.contributorName || 'Alice',
        profilePicture: { path: overrides.userIconPath || '/avatars/user.png' },
      },
      createdDate: overrides.createdDate || '2025-01-01T00:00:00.000Z',
    },
    version: {
      when: overrides.modifiedDate || '2025-01-02T00:00:00.000Z',
    },
    ancestors: overrides.ancestors || [],
  };
}

function createHook({
  params = {},
  resultsPerRequest = 2,
  enableSummaries = true,
  openNoticeDialog = vi.fn(),
} = {}) {
  const hook = mountHook(useSearchResultsController, {
    params: {
      baseUrl: 'https://example.atlassian.net/wiki',
      searchText: '',
      ...params,
    },
    resultsPerRequest,
    enableSummaries,
    openNoticeDialog,
  });
  return { hook, openNoticeDialog };
}

async function flushMany(hook, count = 5) {
  for (let i = 0; i < count; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await hook.flush();
  }
}

describe('useSearchResultsController', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    urlUtilsMocks.updateUrlParams.mockReset();
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ results: [], totalSize: 0 }),
    }));
  });

  it('shows notice when running search with empty query and updates URL/state for valid query', async () => {
    const { hook, openNoticeDialog } = createHook({
      params: {
        searchText: '',
        text: 'focus',
        space: 'ENG:Engineering',
        contributor: 'acct-1:Alice',
        date: '1w',
        type: 'page',
      },
    });
    await hook.flush();

    hook.result.actions.runSearch();
    expect(openNoticeDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Search Query Required',
      tone: 'info',
    }));

    hook.result.actions.setSearchInput('  latency incident  ');
    await hook.flush();
    hook.result.actions.runSearch();
    await hook.flush();

    expect(hook.result.state.searchText).toBe('latency incident');
    expect(urlUtilsMocks.updateUrlParams).toHaveBeenCalledWith(expect.objectContaining({
      searchText: 'latency incident',
      baseUrl: 'https://example.atlassian.net/wiki',
      text: 'focus',
      space: 'ENG:Engineering',
      contributor: 'acct-1:Alice',
      date: '1w',
      type: 'page',
    }));

    hook.unmount();
  });

  it('loads results, filters and sorts table rows, and toggles tree collapse state', async () => {
    const results = [
      makeResult({
        id: '10',
        title: 'Zeta',
        ancestors: [{ id: 'root-1', title: 'Root', _links: { webui: '/pages/root-1' } }],
      }),
      makeResult({
        id: '20',
        title: 'Alpha',
        contributorKey: 'acct-2',
        contributorName: 'Bob',
        ancestors: [{ id: 'root-1', title: 'Root', _links: { webui: '/pages/root-1' } }],
      }),
    ];
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('/rest/api/content/search?')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ results, totalSize: 2 }),
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({}),
      };
    });

    const { hook } = createHook({ params: { searchText: 'alpha' } });
    await flushMany(hook, 4);

    expect(hook.result.derived.allResults).toHaveLength(2);
    expect(hook.result.state.totalSize).toBe(2);
    expect(hook.result.state.allLoaded).toBe(true);
    expect(hook.result.derived.tableResults.map((x) => x.title)).toEqual(['Zeta', 'Alpha']);

    hook.result.actions.toggleTableSort('name');
    await hook.flush();
    expect(hook.result.state.tableSort).toEqual({ key: 'name', direction: 'asc' });
    expect(hook.result.derived.tableResults.map((x) => x.title)).toEqual(['Alpha', 'Zeta']);

    hook.result.actions.toggleTableSort('name');
    await hook.flush();
    expect(hook.result.state.tableSort).toEqual({ key: 'name', direction: 'desc' });
    expect(hook.result.derived.tableResults.map((x) => x.title)).toEqual(['Zeta', 'Alpha']);

    hook.result.actions.toggleTableSort('name');
    await hook.flush();
    expect(hook.result.state.tableSort).toEqual({ key: '', direction: 'asc' });

    hook.result.actions.setFilterText('alph');
    await hook.flush();
    expect(hook.result.derived.filteredResults.map((x) => x.id)).toEqual(['20']);

    hook.result.actions.handleTreeViewClick();
    await hook.flush();
    expect(hook.result.state.collapsedNodes.has('root-1')).toBe(true);

    hook.result.actions.handleTreeViewClick();
    await hook.flush();
    expect(hook.result.state.collapsedNodes.has('root-1')).toBe(false);

    hook.unmount();
  });

  it('builds and clears tree tooltip data and positions tooltip element', async () => {
    const result = makeResult({
      id: '30',
      title: 'Tooltip Page',
      ancestors: [{ id: 'root-2', title: 'Root 2', _links: { webui: '/pages/root-2' } }],
    });
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ results: [result], totalSize: 1 }),
    }));

    const { hook } = createHook({ params: { searchText: 'tooltip' } });
    await flushMany(hook, 4);

    const tip = document.createElement('div');
    Object.defineProperty(tip, 'offsetWidth', { configurable: true, value: 240 });
    Object.defineProperty(tip, 'offsetHeight', { configurable: true, value: 120 });
    hook.result.refs.treeTooltipRef.current = tip;

    const node = hook.result.derived.treeRoots[0];
    hook.result.actions.showTreeTooltip({ clientX: 600, clientY: 420 }, node, true);
    await hook.flush();
    expect(hook.result.state.treeTooltipData).toEqual(expect.objectContaining({
      title: 'Root 2',
      type: 'page',
      contributor: 'Unknown',
      spaceName: 'Engineering',
    }));

    hook.result.actions.moveTreeTooltip({ clientX: 620, clientY: 440 }, node, true);
    expect(tip.style.left).not.toBe('');
    expect(tip.style.top).not.toBe('');

    hook.result.actions.hideTreeTooltip();
    await hook.flush();
    expect(hook.result.state.treeTooltipData).toBe(null);

    hook.unmount();
  });

  it('resizes and resets table columns and supports scrollToTop action', async () => {
    const { hook } = createHook();
    await hook.flush();

    const resizeStartEvent = {
      clientX: 100,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    hook.result.actions.startTableColumnResize(resizeStartEvent, 'name');
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await hook.flush();

    expect(hook.result.state.tableColWidths.name).toBe(DEFAULT_TABLE_COL_WIDTHS.name + 40);
    expect(JSON.parse(sessionStorage.getItem('v2TableColWidths')).name).toBe(DEFAULT_TABLE_COL_WIDTHS.name + 40);

    hook.result.actions.resetTableColumnWidth('name');
    await hook.flush();
    expect(hook.result.state.tableColWidths.name).toBe(DEFAULT_TABLE_COL_WIDTHS.name);

    const scrollTo = vi.fn();
    hook.result.refs.scrollerRef.current = { scrollTo };
    hook.result.actions.scrollToTop();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });

    hook.unmount();
  });

  it('fetches selected space and contributor icons when local options do not include them', async () => {
    global.fetch = vi.fn(async (url) => {
      const href = String(url);
      if (href.includes('/rest/api/space/ENG?expand=icon')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ icon: { path: '/icons/eng.svg' } }),
        };
      }
      if (href.includes('/rest/api/user?accountId=acct-9')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ profilePicture: { path: '/avatars/bob.png' } }),
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ results: [], totalSize: 0 }),
      };
    });

    const { hook } = createHook({
      params: {
        searchText: '',
        space: 'ENG:Engineering',
        contributor: 'acct-9:Bob',
      },
    });
    await flushMany(hook, 4);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.atlassian.net/wiki/rest/api/space/ENG?expand=icon',
      { credentials: 'include' },
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.atlassian.net/wiki/rest/api/user?accountId=acct-9',
      { credentials: 'include' },
    );
    expect(hook.result.state.selectedSpaceIcon).toBe('https://example.atlassian.net/icons/eng.svg');
    expect(hook.result.state.selectedContributorIcon).toBe('https://example.atlassian.net/avatars/bob.png');

    hook.unmount();
  });

  it('handles saved-search application validation and valid apply flow', async () => {
    const openNoticeDialog = vi.fn();
    const { hook } = createHook({ openNoticeDialog });
    await hook.flush();

    const invalidApplied = hook.result.actions.applySavedSearchEntry({
      baseUrl: '',
      searchText: '',
      filters: {},
    });
    expect(invalidApplied).toBe(false);
    expect(openNoticeDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Saved Search Is Invalid',
      tone: 'error',
    }));

    urlUtilsMocks.updateUrlParams.mockClear();
    const validApplied = hook.result.actions.applySavedSearchEntry({
      baseUrl: 'https://other.atlassian.net/wiki',
      searchText: 'prod issue',
      filters: {
        text: { key: 'critical' },
        space: { key: 'OPS', label: 'Operations' },
        contributor: { key: 'acct-5', label: 'Dana' },
        date: '1m',
        type: 'blogpost',
      },
    });
    expect(validApplied).toBe(true);
    await hook.flush();

    expect(hook.result.state.baseUrl).toBe('https://other.atlassian.net/wiki');
    expect(hook.result.state.searchInput).toBe('prod issue');
    expect(hook.result.state.searchText).toBe('prod issue');
    expect(hook.result.state.filterText).toBe('critical');
    expect(hook.result.state.filterSpace).toBe('OPS');
    expect(hook.result.state.spaceInput).toBe('Operations');
    expect(hook.result.state.filterContributor).toBe('acct-5');
    expect(hook.result.state.contributorInput).toBe('Dana');
    expect(hook.result.state.filterDate).toBe('1m');
    expect(hook.result.state.filterType).toBe('blogpost');
    expect(urlUtilsMocks.updateUrlParams).toHaveBeenCalledWith(expect.objectContaining({
      searchText: 'prod issue',
      baseUrl: 'https://other.atlassian.net/wiki',
      text: 'critical',
      space: 'OPS:Operations',
      contributor: 'acct-5:Dana',
      date: '1m',
      type: 'blogpost',
    }));

    hook.unmount();
  });

  it('aborts stale fetch when signature changes and reports fetch errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const signals = [];
    let firstRequest = true;
    const openNoticeDialog = vi.fn();
    global.fetch = vi.fn((url, options = {}) => {
      signals.push(options.signal);
      if (firstRequest) {
        firstRequest = false;
        return new Promise((resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            const err = new Error('AbortError');
            err.name = 'AbortError';
            reject(err);
          });
          setTimeout(() => {
            resolve({
              ok: true,
              status: 200,
              statusText: 'OK',
              json: async () => ({ results: [makeResult({ id: '99' })], totalSize: 1 }),
            });
          }, 30);
        });
      }

      return Promise.resolve({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        json: async () => ({}),
      });
    });

    const { hook } = createHook({
      params: {
        baseUrl: 'https://example.atlassian.net/wiki',
        searchText: 'alpha',
      },
      openNoticeDialog,
    });

    await hook.flush();
    hook.result.actions.updateFilterType('page');
    await flushMany(hook, 3);

    expect(global.fetch).toHaveBeenCalled();
    expect(signals[0]?.aborted).toBe(true);
    expect(openNoticeDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Search Failed',
      tone: 'error',
    }));

    hook.unmount();
  });
});
