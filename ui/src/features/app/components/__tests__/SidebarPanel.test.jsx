import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { SidebarPanel } from '../SidebarPanel.jsx';

function mount(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const renderWithProps = (nextProps) => {
    act(() => {
      render(h(SidebarPanel, nextProps), container);
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
    handleTreeViewClick: vi.fn(),
    setView: vi.fn(),
    saveCurrentSearch: vi.fn(),
    openSavedSearches: vi.fn(),
    filterText: 'alpha',
    setFilterText: vi.fn(),
    spaceBoxRef: { current: null },
    filterSpace: '',
    selectedSpaceIcon: '',
    fallbackSpaceIcon: 'fallback-space',
    spaceInput: '',
    setSpaceInput: vi.fn(),
    setFilterSpace: vi.fn(),
    setSpaceDropdownOpen: vi.fn(),
    setSpaceActiveIndex: vi.fn(),
    spaceDropdownOpen: false,
    handleSpaceInputKeyDown: vi.fn(),
    applySpaceFilter: vi.fn(),
    spaceLookupLoading: false,
    spaceSuggestions: [],
    spaceActiveIndex: -1,
    contributorBoxRef: { current: null },
    filterContributor: '',
    selectedContributorIcon: '',
    fallbackUserIcon: 'fallback-user',
    contributorInput: '',
    setContributorInput: vi.fn(),
    setFilterContributor: vi.fn(),
    setContributorDropdownOpen: vi.fn(),
    setContributorActiveIndex: vi.fn(),
    contributorDropdownOpen: false,
    handleContributorInputKeyDown: vi.fn(),
    applyContributorFilter: vi.fn(),
    contributorLookupLoading: false,
    contributorSuggestions: [],
    contributorActiveIndex: -1,
    filterDate: 'any',
    updateFilterDate: vi.fn(),
    filterType: '',
    updateFilterType: vi.fn(),
    selectedAiModel: 'gpt-5.4',
    changeAiModel: vi.fn(),
    aiModelOptions: [{ value: 'gpt-5.4', label: 'gpt-5.4' }, { value: 'gpt-5-mini', label: 'gpt-5-mini' }],
    loading: false,
    allResultsLength: 10,
    filteredResultsLength: 6,
    totalSize: 50,
    lastFetchAt: 1700000000000,
    formatDate: vi.fn(() => 'formatted-time'),
    ...overrides,
  };
}

describe('SidebarPanel', () => {
  it('handles view, saved-search, top-level filters, model selection, and stats', () => {
    const props = createProps();
    const view = mount(props);

    const viewButtons = view.container.querySelectorAll('.view-btn');
    act(() => {
      viewButtons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      viewButtons[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      viewButtons[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      viewButtons[3].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(props.handleTreeViewClick).toHaveBeenCalledTimes(1);
    expect(props.setView).toHaveBeenCalledWith('table');
    expect(props.saveCurrentSearch).toHaveBeenCalledTimes(1);
    expect(props.openSavedSearches).toHaveBeenCalledTimes(1);

    const textInput = view.container.querySelector('input[placeholder="Filter by text"]');
    textInput.value = 'beta';
    act(() => {
      textInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(props.setFilterText).toHaveBeenCalledWith('beta');

    act(() => {
      view.container.querySelector('#filter-date-sidebar')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const dateOption = view.container.querySelector('.custom-select-option[data-value="1w"]');
    expect(dateOption).toBeTruthy();
    act(() => {
      dateOption.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    act(() => {
      view.container.querySelector('#filter-type-sidebar')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const typeOption = view.container.querySelector('.custom-select-option[data-value="page"]');
    expect(typeOption).toBeTruthy();
    act(() => {
      typeOption.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const modelTrigger = view.container.querySelector('#ai-model-sidebar');
    expect(modelTrigger).toBeTruthy();
    act(() => {
      modelTrigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const modelOption = view.container.querySelector('.ai-model-select-option[data-value="gpt-5-mini"]');
    expect(modelOption).toBeTruthy();
    act(() => {
      modelOption.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(props.updateFilterDate).toHaveBeenCalledWith('1w');
    expect(props.updateFilterType).toHaveBeenCalledWith('page');
    expect(props.changeAiModel).toHaveBeenCalledWith('gpt-5-mini');

    expect(view.container.textContent).toContain('6 (10/50 loaded)');
    expect(view.container.textContent).toContain('formatted-time');
    expect(props.formatDate).toHaveBeenCalled();
    view.unmount();
  });

  it('handles space combo interactions including selected icon fallback and dropdown options', () => {
    const props = createProps({
      filterSpace: 'ENG',
      selectedSpaceIcon: 'broken-space-icon',
      spaceInput: 'Eng',
      spaceDropdownOpen: true,
      spaceLookupLoading: true,
      spaceSuggestions: [{ key: 'ENG', name: 'Engineering', iconUrl: 'eng-icon' }],
      spaceActiveIndex: 0,
    });
    const view = mount(props);

    const selectedIcon = view.container.querySelector('.field .selected-filter-icon');
    act(() => {
      selectedIcon.dispatchEvent(new Event('error'));
    });
    expect(selectedIcon.getAttribute('src')).toBe('fallback-space');

    const spaceInput = view.container.querySelector('input[placeholder="Filter spaces (type to search)"]');
    spaceInput.value = 'Engineering';
    act(() => {
      spaceInput.dispatchEvent(new Event('input', { bubbles: true }));
      spaceInput.dispatchEvent(new Event('focus', { bubbles: true }));
      spaceInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(props.setSpaceInput).toHaveBeenCalledWith('Engineering');
    expect(props.setFilterSpace).toHaveBeenCalledWith('');
    expect(props.setSpaceDropdownOpen).toHaveBeenCalledWith(true);
    expect(props.setSpaceActiveIndex).toHaveBeenCalledWith(-1);
    expect(props.handleSpaceInputKeyDown).toHaveBeenCalled();

    const clearSelected = view.container.querySelectorAll('.combo-clear-selected')[0];
    const option = view.container.querySelector('.space-options .combo-option');
    act(() => {
      clearSelected.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      option.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      option.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(props.applySpaceFilter).toHaveBeenCalledWith(null);
    expect(props.setSpaceInput).toHaveBeenCalledWith('');
    expect(props.setSpaceActiveIndex).toHaveBeenCalledWith(0);
    expect(props.applySpaceFilter).toHaveBeenCalledWith({ key: 'ENG', name: 'Engineering', iconUrl: 'eng-icon' });
    expect(view.container.textContent).toContain('Searching...');
    view.unmount();
  });

  it('handles contributor combo fallback icon, clear action, and empty dropdown state', () => {
    const props = createProps({
      filterContributor: 'alice',
      selectedContributorIcon: 'broken-user-icon',
      contributorInput: 'Alice',
      contributorDropdownOpen: true,
      contributorSuggestions: [],
    });
    const view = mount(props);

    const contributorInput = view.container.querySelector('input[placeholder="Filter contributors (type to search)"]');
    const contributorField = contributorInput?.closest('.combo-field');
    const selectedIcon = contributorField?.querySelector('.selected-filter-icon');
    expect(selectedIcon).toBeTruthy();
    act(() => {
      selectedIcon.dispatchEvent(new Event('error'));
    });
    expect(selectedIcon.getAttribute('src')).toBe('fallback-user');

    contributorInput.value = 'Bob';
    act(() => {
      contributorInput.dispatchEvent(new Event('input', { bubbles: true }));
      contributorInput.dispatchEvent(new Event('focus', { bubbles: true }));
      contributorInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(props.setContributorInput).toHaveBeenCalledWith('Bob');
    expect(props.setFilterContributor).toHaveBeenCalledWith('');
    expect(props.setContributorDropdownOpen).toHaveBeenCalledWith(true);
    expect(props.setContributorActiveIndex).toHaveBeenCalledWith(-1);
    expect(props.handleContributorInputKeyDown).toHaveBeenCalled();

    const clearSelected = view.container.querySelectorAll('.combo-clear-selected')[0];
    act(() => {
      clearSelected.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(props.applyContributorFilter).toHaveBeenCalledWith(null);
    expect(props.setContributorInput).toHaveBeenCalledWith('');
    expect(view.container.textContent).toContain('No contributors found.');
    view.unmount();
  });
});
