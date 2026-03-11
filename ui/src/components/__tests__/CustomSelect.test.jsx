import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { CustomSelect } from '../CustomSelect.jsx';

function mount(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    render(h(CustomSelect, props), container);
  });
  return {
    container,
    rerender(nextProps) {
      act(() => {
        render(h(CustomSelect, nextProps), container);
      });
    },
    unmount() {
      act(() => {
        render(null, container);
      });
      container.remove();
    },
  };
}

describe('CustomSelect', () => {
  it('moves active option by one step for ArrowDown and commits expected option on Enter', () => {
    const onChange = vi.fn();
    const options = [
      { value: 'gpt-5.4', label: 'gpt-5.4' },
      { value: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
      { value: 'gpt-5-codex', label: 'gpt-5-codex' },
    ];
    const view = mount({
      id: 'custom-select-test',
      ariaLabel: 'AI model',
      value: 'gpt-5.4',
      options,
      onChange,
    });

    const trigger = view.container.querySelector('#custom-select-test');
    expect(trigger).toBeTruthy();
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    act(() => {
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });

    const activeOption = view.container.querySelector('.custom-select-option.is-active');
    expect(activeOption?.getAttribute('data-value')).toBe('gpt-5.3-codex');

    act(() => {
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('gpt-5.3-codex');

    view.unmount();
  });

  it('closes popup when pressing Escape', () => {
    const view = mount({
      id: 'custom-select-escape',
      ariaLabel: 'AI model',
      value: 'gpt-5.4',
      options: [{ value: 'gpt-5.4', label: 'gpt-5.4' }],
      onChange: vi.fn(),
    });

    const trigger = view.container.querySelector('#custom-select-escape');
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(view.container.querySelector('.custom-select-panel')).toBeTruthy();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(view.container.querySelector('.custom-select-panel')).toBeNull();

    view.unmount();
  });
});
