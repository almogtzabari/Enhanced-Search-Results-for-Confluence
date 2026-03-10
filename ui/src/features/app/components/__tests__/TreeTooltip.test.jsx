import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { describe, expect, it } from 'vitest';

import { TreeTooltip } from '../TreeTooltip.jsx';

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

describe('TreeTooltip', () => {
  it('returns null without tooltip data', () => {
    const view = mount(h(TreeTooltip, {
      treeTooltipData: null,
      treeTooltipRef: { current: null },
      typeIcons: {},
      typeLabels: {},
      fallbackUserIcon: 'fallback-user',
      fallbackSpaceIcon: 'fallback-space',
    }));
    expect(view.container.innerHTML).toBe('');
    view.unmount();
  });

  it('renders tooltip details and applies fallback images on load errors', () => {
    const view = mount(h(TreeTooltip, {
      treeTooltipData: {
        type: 'unknown',
        title: 'Page A',
        url: 'https://example.atlassian.net/wiki/pages/1',
        avatarUrl: 'broken-user',
        contributor: 'Alice',
        spaceIconUrl: 'broken-space',
        spaceName: 'Engineering',
        modified: '2026-03-10',
      },
      treeTooltipRef: { current: null },
      typeIcons: { page: '📄' },
      typeLabels: { page: 'Page' },
      fallbackUserIcon: 'fallback-user',
      fallbackSpaceIcon: 'fallback-space',
    }));

    expect(view.container.querySelector('.tree-tooltip-v2-title')?.textContent).toBe('Page A');
    expect(view.container.querySelector('.tree-tooltip-v2-kicker')?.textContent).toContain('unknown');
    expect(view.container.querySelector('.tree-tooltip-v2-footer')?.textContent).toContain('2026-03-10');

    const avatar = view.container.querySelector('.tree-tooltip-avatar');
    const space = view.container.querySelector('.tree-tooltip-space-mini');

    act(() => {
      avatar.dispatchEvent(new Event('error'));
      space.dispatchEvent(new Event('error'));
    });

    expect(avatar.getAttribute('src')).toBe('fallback-user');
    expect(space.getAttribute('src')).toBe('fallback-space');
    view.unmount();
  });
});
