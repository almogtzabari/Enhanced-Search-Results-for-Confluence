import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog, NoticeDialog, SaveNameDialog } from '../Dialogs.jsx';

function mount(node) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    render(node, container);
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

describe('Dialogs', () => {
  it('SaveNameDialog supports input, submit, and overlay close', () => {
    const onClose = vi.fn();
    const onChangeValue = vi.fn();
    const onSubmit = vi.fn();

    const view = mount(h(SaveNameDialog, {
      open: true,
      dialog: {
        title: 'Name this search',
        value: 'Initial',
        placeholder: 'Search name',
        confirmLabel: 'Save',
      },
      inputRef: { current: null },
      onClose,
      onChangeValue,
      onSubmit,
    }));

    const input = view.container.querySelector('#save-name-input');
    input.value = 'Renamed';
    act(() => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onChangeValue).toHaveBeenCalledWith('Renamed');
    expect(onSubmit).toHaveBeenCalledTimes(1);

    act(() => {
      view.container.querySelector('.name-dialog').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      view.container.querySelector('.name-dialog-overlay').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledWith(null);
    view.unmount();
  });

  it('ConfirmDialog returns false/true for cancel/confirm and supports overlay close', () => {
    const onClose = vi.fn();
    const view = mount(h(ConfirmDialog, {
      open: true,
      dialog: {
        title: 'Delete?',
        message: 'Cannot be undone',
        confirmLabel: 'Delete',
        danger: true,
      },
      onClose,
    }));

    act(() => {
      const buttons = view.container.querySelectorAll('.confirm-dialog-actions .btn');
      buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      buttons[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      view.container.querySelector('.confirm-dialog-overlay').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledWith(false);
    expect(onClose).toHaveBeenCalledWith(true);
    expect(view.container.querySelector('.confirm-dialog .btn.danger')).toBeTruthy();
    view.unmount();
  });

  it('NoticeDialog renders tone class and closes from button and overlay', () => {
    const onClose = vi.fn();
    const view = mount(h(NoticeDialog, {
      open: true,
      dialog: { title: 'Notice', message: 'Hello', tone: 'error' },
      onClose,
    }));

    expect(view.container.querySelector('.notice-dialog.error')).toBeTruthy();
    act(() => {
      view.container.querySelector('.notice-dialog-actions .btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      view.container.querySelector('.notice-dialog-overlay').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('returns null when dialogs are closed', () => {
    const view = mount(h('div', {}, [
      h(SaveNameDialog, { open: false, dialog: {}, inputRef: { current: null }, onClose: vi.fn(), onChangeValue: vi.fn(), onSubmit: vi.fn() }),
      h(ConfirmDialog, { open: false, dialog: {}, onClose: vi.fn() }),
      h(NoticeDialog, { open: false, dialog: {}, onClose: vi.fn() }),
    ]));
    expect(view.container.textContent).toBe('');
    view.unmount();
  });
});
