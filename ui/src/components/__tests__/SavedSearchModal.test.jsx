import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { SavedSearchModal } from '../SavedSearchModal.jsx';

function mount(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    render(h(SavedSearchModal, props), container);
  });
  return {
    container,
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
    savedModalOpen: true,
    onClose: vi.fn(),
    savedSearchQuery: 'alpha',
    setSavedSearchQuery: vi.fn(),
    removeAllSavedSearches: vi.fn(),
    savedSearchesFiltered: [],
    savedSearchVisualsById: {},
    fallbackSpaceIcon: 'space-fallback',
    fallbackUserIcon: 'user-fallback',
    formatDate: vi.fn((value) => `fmt:${value}`),
    runSavedSearch: vi.fn(),
    renameSavedSearch: vi.fn(),
    removeSavedSearch: vi.fn(),
    ...overrides,
  };
}

describe('SavedSearchModal', () => {
  it('returns null when closed', () => {
    const view = mount(createProps({ savedModalOpen: false }));
    expect(view.container.textContent).toBe('');
    view.unmount();
  });

  it('renders empty state and handles top-level actions', () => {
    const props = createProps();
    const view = mount(props);

    expect(view.container.textContent).toContain('Saved Searches');
    expect(view.container.textContent).toContain('No saved searches.');

    const searchInput = view.container.querySelector('input[placeholder="Filter saved searches..."]');
    searchInput.value = 'beta';
    act(() => {
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(props.setSavedSearchQuery).toHaveBeenCalledWith('beta');

    const clearAllButton = Array.from(view.container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Clear All');
    const closeButton = view.container.querySelector('.saved-modal-head .icon-btn');
    const modal = view.container.querySelector('.saved-modal');
    const overlay = view.container.querySelector('.saved-modal-overlay');

    act(() => {
      clearAllButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      closeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(props.removeAllSavedSearches).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);

    act(() => {
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(props.onClose).toHaveBeenCalledTimes(2);

    view.unmount();
  });

  it('renders entries, uses icon fallbacks, and wires row actions', () => {
    const entryA = {
      id: 'a',
      name: 'Frontend triage',
      searchText: 'latency',
      filters: {
        space: { key: 'ENG', label: 'Engineering' },
        contributor: { key: 'u-1', label: 'Alice' },
        text: { key: 'slow', label: 'Slow pages' },
        date: '1w',
        type: 'page',
      },
      createdAt: 1700000000000,
      updatedAt: 1700000009999,
    };

    const entryB = {
      id: 'b',
      name: 'Fallback values',
      searchText: '',
      filters: {},
      createdAt: 1700000100000,
    };

    const props = createProps({
      savedSearchesFiltered: [entryA, entryB],
      savedSearchVisualsById: {
        a: {
          spaceIconUrl: 'broken-space-icon',
          contributorIconUrl: 'broken-user-icon',
        },
      },
    });

    const view = mount(props);

    expect(view.container.textContent).toContain('Frontend triage');
    expect(view.container.textContent).toContain('Fallback values');
    expect(view.container.textContent).toContain('Search: latency');
    expect(view.container.textContent).toContain('Search: N/A');
    expect(view.container.textContent).toContain('Text: Slow pages');
    expect(view.container.textContent).toContain('Text: Any');
    expect(view.container.textContent).toContain('Date Filter: 1w');
    expect(view.container.textContent).toContain('Date Filter: any');
    expect(view.container.textContent).toContain('Type: page');
    expect(view.container.textContent).toContain('Type: Any');
    expect(props.formatDate).toHaveBeenCalled();

    const icons = view.container.querySelectorAll('.saved-entry-icon-large');
    expect(icons).toHaveLength(4);
    expect(icons[2].getAttribute('src')).toBe('space-fallback');
    expect(icons[3].getAttribute('src')).toBe('user-fallback');

    act(() => {
      icons[0].dispatchEvent(new Event('error'));
      icons[1].dispatchEvent(new Event('error'));
    });
    expect(icons[0].getAttribute('src')).toBe('space-fallback');
    expect(icons[1].getAttribute('src')).toBe('user-fallback');

    const buttons = view.container.querySelectorAll('.saved-entry-actions .btn');
    act(() => {
      buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      buttons[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      buttons[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(props.runSavedSearch).toHaveBeenCalledWith(entryA);
    expect(props.renameSavedSearch).toHaveBeenCalledWith(entryA);
    expect(props.removeSavedSearch).toHaveBeenCalledWith(entryA);

    view.unmount();
  });
});
