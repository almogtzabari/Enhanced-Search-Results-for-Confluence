import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { TopBarSearch } from '../TopBarSearch.jsx';

function mount(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const renderWithProps = (nextProps) => {
    act(() => {
      render(h(TopBarSearch, nextProps), container);
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

describe('TopBarSearch', () => {
  it('renders domain, handles search input and triggers runSearch actions', () => {
    const setSearchInput = vi.fn();
    const runSearch = vi.fn();
    const toggleDarkMode = vi.fn();
    const openOptions = vi.fn();

    const view = mount({
      domainName: 'example.atlassian.net',
      isDarkMode: false,
      toggleDarkMode,
      openOptions,
      searchInputAttention: true,
      searchInputRef: { current: null },
      searchInput: 'alpha',
      setSearchInput,
      runSearch,
    });

    expect(view.container.querySelector('h1')?.textContent).toBe('example.atlassian.net');
    expect(view.container.querySelector('.search-row')?.className).toContain('search-row-attention');

    const input = view.container.querySelector('.search-input');
    input.value = 'beta';
    act(() => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(setSearchInput).toHaveBeenCalledWith('beta');
    expect(runSearch).toHaveBeenCalledTimes(1);

    act(() => {
      view.container.querySelector('.clear-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      view.container.querySelector('.search-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(setSearchInput).toHaveBeenCalledWith('');
    expect(runSearch).toHaveBeenCalledTimes(2);

    view.unmount();
  });

  it('fires theme toggle and options handlers from topbar icons', () => {
    const toggleDarkMode = vi.fn();
    const openOptions = vi.fn();

    const view = mount({
      domainName: 'example',
      isDarkMode: true,
      toggleDarkMode,
      openOptions,
      searchInputAttention: false,
      searchInputRef: { current: null },
      searchInput: '',
      setSearchInput: vi.fn(),
      runSearch: vi.fn(),
    });

    act(() => {
      view.container.querySelector('.topbar-icon-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      view.container.querySelector('.settings-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(toggleDarkMode).toHaveBeenCalledTimes(1);
    expect(openOptions).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector('.theme-moon-emoji')).toBeTruthy();
    view.unmount();
  });
});
