import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { TreeNode } from '../TreeNode.jsx';

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

function createNode(overrides = {}) {
  return {
    id: '1',
    title: 'Root',
    url: 'https://example.atlassian.net/wiki/pages/1',
    type: 'page',
    isResult: true,
    sourceItem: { id: '1', title: 'Root' },
    children: [{
      id: '2',
      title: 'Child',
      url: 'https://example.atlassian.net/wiki/pages/2',
      type: 'page',
      isResult: false,
      sourceItem: { id: '2', title: 'Child' },
      children: [],
    }],
    ...overrides,
  };
}

function renderTreeNode(props = {}) {
  const onToggle = vi.fn();
  const onShowTooltip = vi.fn();
  const onMoveTooltip = vi.fn();
  const onHideTooltip = vi.fn();
  const onSummarize = vi.fn();
  const node = createNode(props.nodeOverrides);
  const view = mount(h('ul', {}, h(TreeNode, {
    node,
    collapsed: props.collapsed ?? new Set(),
    onToggle,
    highlightResultRows: props.highlightResultRows ?? true,
    showTreeTooltips: props.showTreeTooltips ?? true,
    onShowTooltip,
    onMoveTooltip,
    onHideTooltip,
    canSummarize: props.canSummarize ?? true,
    aiLoadingItemId: props.aiLoadingItemId ?? null,
    aiSummaryStatusById: props.aiSummaryStatusById ?? {},
    onSummarize,
  })));
  return {
    view,
    node,
    onToggle,
    onShowTooltip,
    onMoveTooltip,
    onHideTooltip,
    onSummarize,
  };
}

describe('TreeNode', () => {
  it('renders result row with toggle and handles tooltip + summarize interactions', () => {
    const t = renderTreeNode();
    const row = t.view.container.querySelector('.tree-row');
    const toggle = t.view.container.querySelector('.toggle');
    const summarize = t.view.container.querySelector('.mini-ai-btn');

    expect(row.className).toContain('tree-row-result');
    expect(t.view.container.querySelector('.tree-list')).toBeTruthy();
    expect(summarize.textContent).toContain('Summarize');

    act(() => {
      row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      row.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      row.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      summarize.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(t.onShowTooltip).toHaveBeenCalledWith(expect.any(MouseEvent), t.node);
    expect(t.onMoveTooltip).toHaveBeenCalledWith(expect.any(MouseEvent), t.node);
    expect(t.onHideTooltip).toHaveBeenCalledTimes(1);
    expect(t.onToggle).toHaveBeenCalledWith('1');
    expect(t.onSummarize).toHaveBeenCalledWith(t.node.sourceItem);
    t.view.unmount();
  });

  it('hides children when collapsed and suppresses tooltip handlers when disabled', () => {
    const t = renderTreeNode({
      collapsed: new Set(['1']),
      showTreeTooltips: false,
    });
    const row = t.view.container.querySelector('.tree-row');

    expect(t.view.container.querySelector('.tree-list')).toBeFalsy();
    expect(t.view.container.querySelector('.toggle')?.textContent).toContain('▸');

    act(() => {
      row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      row.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      row.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    });
    expect(t.onShowTooltip).not.toHaveBeenCalled();
    expect(t.onMoveTooltip).not.toHaveBeenCalled();
    expect(t.onHideTooltip).not.toHaveBeenCalled();
    t.view.unmount();
  });

  it('uses loading/ready AI states and parent styling when not highlighted', () => {
    const loadingView = renderTreeNode({
      aiLoadingItemId: '1',
      highlightResultRows: false,
    });
    const loadingBtn = loadingView.view.container.querySelector('.mini-ai-btn');
    expect(loadingView.view.container.querySelector('.tree-row')?.className).toContain('tree-row-parent');
    expect(loadingBtn.disabled).toBe(true);
    expect(loadingBtn.textContent).toContain('Thinking...');
    loadingView.view.unmount();

    const readyView = renderTreeNode({
      aiSummaryStatusById: { 1: 'ready' },
    });
    const readyBtn = readyView.view.container.querySelector('.mini-ai-btn');
    expect(readyBtn.getAttribute('data-status')).toBe('ready');
    expect(readyBtn.textContent).toContain('Open');
    readyView.view.unmount();
  });
});
