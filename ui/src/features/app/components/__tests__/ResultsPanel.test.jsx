import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const treeNodeCapture = vi.hoisted(() => ({
  calls: [],
}));

vi.mock('../TreeNode.jsx', () => ({
  TreeNode: (props) => {
    treeNodeCapture.calls.push(props);
    return h('li', { class: 'tree-node-mock' }, props.node?.title || 'node');
  },
}));

import { ResultsPanel } from '../ResultsPanel.jsx';

function mount(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const renderWithProps = (nextProps) => {
    act(() => {
      render(h(ResultsPanel, nextProps), container);
    });
  };

  renderWithProps(props);
  return {
    container,
    rerender: renderWithProps,
    unmount() {
      act(() => {
        render(null, container);
      });
      container.remove();
    },
  };
}

function createProps(overrides = {}) {
  return {
    view: 'tree',
    scrollerRef: { current: null },
    treeRoots: [],
    isInitialSearching: false,
    searchText: '',
    collapsedNodes: new Set(),
    toggleNode: vi.fn(),
    highlightResultRows: true,
    showTreeTooltips: true,
    showTreeTooltip: vi.fn(),
    moveTreeTooltip: vi.fn(),
    hideTreeTooltip: vi.fn(),
    enableSummaries: true,
    aiItemLoadingId: null,
    aiSummaryStatusById: {},
    openAiSummaryModal: vi.fn(),
    filteredResults: [],
    tableMinWidth: 700,
    tableColumns: [
      { key: 'type', label: 'Type', sortable: true },
      { key: 'name', label: 'Name', sortable: true },
      { key: 'space', label: 'Space', sortable: true },
      { key: 'contributor', label: 'Contributor', sortable: true },
      { key: 'created', label: 'Created', sortable: true },
      { key: 'modified', label: 'Modified', sortable: true },
      { key: 'ai', label: 'AI', sortable: false },
    ],
    tableColWidths: { type: 80, name: 220, space: 180, contributor: 190, created: 120, modified: 120, ai: 100 },
    defaultTableColWidths: { type: 80, name: 220, space: 180, contributor: 190, created: 120, modified: 120, ai: 100 },
    toggleTableSort: vi.fn(),
    tableSort: { key: '', direction: 'asc' },
    startTableColumnResize: vi.fn(),
    resetTableColumnWidth: vi.fn(),
    tableResults: [],
    typeIcons: { page: '📄' },
    baseUrl: 'https://example.atlassian.net/wiki',
    buildConfluenceUrl: (base, path) => (path ? `${base}${path}` : '#'),
    resolveConfluenceIconUrl: (base, path, fallback) => (path ? `${base}${path}` : fallback),
    fallbackUserIcon: 'fallback-user',
    fallbackSpaceIcon: 'fallback-space',
    showTableTooltips: true,
    formatDate: vi.fn((value) => String(value || '')),
    loading: false,
    allResultsLength: 0,
    allLoaded: false,
    ...overrides,
  };
}

describe('ResultsPanel', () => {
  beforeEach(() => {
    treeNodeCapture.calls = [];
  });

  it('renders tree-mode searching/empty/root states', () => {
    const props = createProps({
      view: 'tree',
      isInitialSearching: true,
      searchText: 'alpha',
      treeRoots: [],
    });
    const view = mount(props);
    expect(view.container.textContent).toContain('Searching Confluence...');

    view.rerender(createProps({
      view: 'tree',
      isInitialSearching: false,
      searchText: 'alpha',
      treeRoots: [],
    }));
    expect(view.container.textContent).toContain('No results to display.');

    view.rerender(createProps({
      view: 'tree',
      isInitialSearching: false,
      searchText: '',
      treeRoots: [],
    }));
    expect(view.container.textContent).toContain('Enter a search query to begin.');

    const node = {
      id: '1',
      title: 'Root',
      children: [],
      sourceItem: { id: '1' },
    };
    view.rerender(createProps({
      view: 'tree',
      treeRoots: [node],
      collapsedNodes: new Set(['1']),
      aiItemLoadingId: '1',
      aiSummaryStatusById: { 1: 'ready' },
    }));
    expect(view.container.querySelector('.tree-list.root')).toBeTruthy();
    expect(treeNodeCapture.calls).toHaveLength(1);
    expect(treeNodeCapture.calls[0]).toMatchObject({
      node,
      collapsed: new Set(['1']),
      canSummarize: true,
      aiLoadingItemId: '1',
    });
    view.unmount();
  });

  it('renders table rows and triggers sort/resize/summarize interactions', () => {
    const item = {
      id: '10',
      type: 'page',
      title: 'Page 10',
      _links: { webui: '/pages/10' },
      space: { name: 'Engineering', icon: { path: '/space.png' }, _links: { webui: '/spaces/ENG' } },
      history: { createdBy: { username: 'alice', displayName: 'Alice', profilePicture: { path: '/alice.png' } }, createdDate: '2026-03-10' },
      version: { when: '2026-03-11' },
    };

    const props = createProps({
      view: 'table',
      searchText: 'alpha',
      filteredResults: [item],
      tableResults: [item],
      tableSort: { key: 'name', direction: 'desc' },
      aiSummaryStatusById: { 10: 'ready' },
      formatDate: vi.fn((value) => `F:${value}`),
    });
    const view = mount(props);

    expect(view.container.querySelector('.results-table')).toBeTruthy();
    expect(view.container.textContent).toContain('Page 10');
    expect(view.container.textContent).toContain('Alice');
    expect(view.container.textContent).toContain('Engineering');
    expect(view.container.textContent).toContain('Open');
    expect(props.formatDate).toHaveBeenCalled();

    const firstSortBtn = view.container.querySelector('.table-sort-btn');
    const firstResizer = view.container.querySelector('.th-resizer-v2');
    const aiBtn = view.container.querySelector('.mini-ai-btn');
    act(() => {
      firstSortBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      firstResizer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      firstResizer.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      aiBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(props.toggleTableSort).toHaveBeenCalledWith('type');
    expect(props.startTableColumnResize).toHaveBeenCalledWith(expect.any(MouseEvent), 'type');
    expect(props.resetTableColumnWidth).toHaveBeenCalledWith('type');
    expect(props.openAiSummaryModal).toHaveBeenCalledWith(item);

    const imgs = view.container.querySelectorAll('img');
    const spaceImg = Array.from(imgs).find((img) => img.classList.contains('table-entity-avatar-space'));
    const userImg = Array.from(imgs).find((img) => img.classList.contains('table-entity-avatar') && !img.classList.contains('table-entity-avatar-space'));
    act(() => {
      spaceImg.dispatchEvent(new Event('error'));
      userImg.dispatchEvent(new Event('error'));
    });
    expect(spaceImg.getAttribute('src')).toBe('fallback-space');
    expect(userImg.getAttribute('src')).toBe('fallback-user');
    view.unmount();
  });

  it('shows loading and end-of-results lines in table mode', () => {
    const item = {
      id: '20',
      type: 'page',
      title: 'Page 20',
      _links: { webui: '/pages/20' },
      space: { name: '', _links: {}, icon: {} },
      history: { createdBy: {}, createdDate: '' },
      version: { when: '' },
    };
    const view = mount(createProps({
      view: 'table',
      searchText: 'alpha',
      filteredResults: [item],
      tableResults: [item],
      loading: true,
      allResultsLength: 1,
      allLoaded: false,
    }));
    expect(view.container.textContent).toContain('Loading more results');

    view.rerender(createProps({
      view: 'table',
      searchText: 'alpha',
      filteredResults: [item],
      tableResults: [item],
      loading: false,
      allResultsLength: 1,
      allLoaded: true,
    }));
    expect(view.container.textContent).toContain('All results loaded.');
    view.unmount();
  });
});
