import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { AiModal } from '../AiModal.jsx';

function mount(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const rerender = (nextProps) => {
    act(() => {
      render(h(AiModal, nextProps), container);
    });
  };

  rerender(props);

  return {
    container,
    rerender,
    unmount() {
      act(() => {
        render(null, container);
      });
      container.remove();
    },
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function createProps(overrides = {}) {
  return {
    aiModalOpen: true,
    closeAiModal: vi.fn(),
    aiModalRef: { current: null },
    aiModalWidth: 900,
    aiModalHeight: 620,
    startAiModalResize: vi.fn(),
    resetAiModalWidth: vi.fn(),
    startAiModalHeightResize: vi.fn(),
    resetAiModalHeight: vi.fn(),
    aiActiveItem: {
      title: 'Release notes',
      type: 'blogpost',
      _links: { webui: '/pages/123' },
      space: { name: 'Engineering' },
    },
    buildConfluenceUrl: vi.fn((baseUrl, webui) => `${baseUrl}${webui}`),
    baseUrl: 'https://example.atlassian.net/wiki',
    aiModalLoading: false,
    aiModalLoadingTitle: 'Building your summary',
    typeIcons: { blogpost: '📰' },
    aiSpaceIconSrc: 'broken-space-icon',
    fallbackSpaceIcon: 'space-fallback',
    aiContributorIconSrc: 'broken-user-icon',
    fallbackUserIcon: 'user-fallback',
    aiContributorName: 'Alex',
    selectedAiModel: 'gpt-5.5',
    aiModelOptions: [
      { value: 'gpt-5.5', label: 'gpt-5.5' },
      { value: 'gpt-5.4', label: 'gpt-5.4' },
      { value: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
      { value: 'gpt-5-codex', label: 'gpt-5-codex' },
    ],
    changeAiModel: vi.fn(),
    isAiSummaryCollapsed: false,
    isAiChatCollapsed: false,
    aiLayoutRef: { current: null },
    aiSummaryPaneRatio: 0.58,
    resummarizeActiveItem: vi.fn(),
    aiSummaryRefreshing: false,
    aiAnswerLoading: false,
    adjustAiSummaryFontSize: vi.fn(),
    aiFontSizeStepPx: 1,
    aiSummaryFontSize: 14,
    minAiSummaryFontSizePx: 12,
    maxAiSummaryFontSizePx: 16,
    toggleChatPane: vi.fn(),
    toggleSummaryPane: vi.fn(),
    aiSummaryDirection: 'ltr',
    aiSummaryHtml: `
      <table>
        <thead>
          <tr><th>Score</th><th>Name</th></tr>
        </thead>
        <tbody>
          <tr><td>20</td><td>B</td></tr>
          <tr><td>3</td><td>A</td></tr>
        </tbody>
      </table>
    `,
    startAiPaneResize: vi.fn(),
    resetAiSummaryPaneRatio: vi.fn(),
    clearAiConversation: vi.fn(),
    adjustAiChatFontSize: vi.fn(),
    aiChatFontSize: 14,
    minAiChatFontSizePx: 12,
    maxAiChatFontSizePx: 16,
    aiThreadRef: { current: null },
    aiConversation: [
      { role: 'system', content: 's0' },
      { role: 'user', content: 'q0' },
      { role: 'assistant', content: '<p>a0</p>' },
      { role: 'user', content: 'rtl text' },
      { role: 'assistant', content: '<p>assistant final</p>' },
    ],
    detectDirectionFromHtml: vi.fn(() => 'ltr'),
    sanitizeHtmlFragment: vi.fn((html) => html),
    detectDirection: vi.fn(() => 'rtl'),
    startAiQuestionInputResize: vi.fn(),
    resetAiQuestionInputHeight: vi.fn(),
    aiQuestionInputRef: { current: null },
    aiQuestion: 'What changed?',
    setAiQuestion: vi.fn(),
    submitAiQuestion: vi.fn(),
    aiQuestionInputHeight: 92,
    ...overrides,
  };
}

describe('AiModal', () => {
  it('returns null when closed', () => {
    const view = mount(createProps({ aiModalOpen: false }));
    expect(view.container.textContent).toBe('');
    view.unmount();
  });

  it('renders loading shell and wires close and outer modal resize handlers', () => {
    const props = createProps({ aiModalLoading: true });
    const view = mount(props);

    expect(view.container.textContent).toContain('Building your summary');
    expect(view.container.querySelector('.ai-modal-content')).toBeFalsy();
    expect(view.container.querySelector('.ai-loading-meta')).toBeFalsy();
    expect(view.container.textContent).not.toContain('Type:');
    expect(view.container.textContent).not.toContain('Space:');
    expect(view.container.textContent).not.toContain('Contributor:');
    expect(view.container.textContent).not.toContain('Open page');

    const overlay = view.container.querySelector('.ai-modal-overlay');
    const modal = view.container.querySelector('.ai-modal');
    const closeButton = view.container.querySelector('.ai-modal-head .icon-btn');

    act(() => {
      modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      closeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(props.closeAiModal).toHaveBeenCalledTimes(2);

    const verticalResizers = view.container.querySelectorAll('.ai-modal-resizer');
    const heightResizers = view.container.querySelectorAll('.ai-modal-height-resizer');
    const sideHints = view.container.querySelectorAll('.ai-modal-side-hint');
    expect(sideHints).toHaveLength(2);
    expect(view.container.querySelector('.ai-modal-side-hints')?.getAttribute('aria-hidden')).toBe('true');
    act(() => {
      verticalResizers[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      heightResizers[1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(props.resetAiModalWidth).toHaveBeenCalledTimes(1);
    expect(props.resetAiModalHeight).toHaveBeenCalledTimes(1);

    view.unmount();
  });

  it('renders custom loading title when provided', () => {
    const props = createProps({
      aiModalLoading: true,
      aiModalLoadingTitle: 'Loading your summary',
    });
    const view = mount(props);

    expect(view.container.textContent).toContain('Loading your summary');
    view.unmount();
  });

  it('reports content-modal bounds only to the configured Confluence origin', async () => {
    const originalParent = window.parent;
    const parentWindow = { postMessage: vi.fn() };
    const animationFrameCallbacks = [];
    const timeoutCallbacks = [];
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        animationFrameCallbacks.push(callback);
        return animationFrameCallbacks.length;
      });
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const setTimeout = vi.spyOn(window, 'setTimeout').mockImplementation((callback) => {
      timeoutCallbacks.push(callback);
      return timeoutCallbacks.length;
    });
    const clearTimeout = vi.spyOn(window, 'clearTimeout').mockImplementation(() => {});
    const getBoundingClientRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({
        x: 120,
        y: 80,
        top: 80,
        right: 760,
        bottom: 560,
        left: 120,
        width: 640,
        height: 480,
        toJSON: () => ({}),
      });
    const resizeObservers = [];
    const originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = class ResizeObserverMock {
      constructor(callback) {
        this.callback = callback;
        this.observe = vi.fn();
        this.disconnect = vi.fn();
        resizeObservers.push(this);
      }
    };
    Object.defineProperty(window, 'parent', { configurable: true, value: parentWindow });

    try {
      const props = createProps({ modalOnlyMode: true });
      const view = mount(props);
      await flush();

      expect(parentWindow.postMessage).toHaveBeenCalledWith({
        type: 'enhanced-ai-modal-bounds',
        bounds: { x: 120, y: 80, width: 640, height: 480 },
      }, 'https://example.atlassian.net');
      expect(resizeObservers).toHaveLength(1);
      expect(resizeObservers[0].observe).toHaveBeenCalledWith(view.container.querySelector('.ai-modal'));
      expect(animationFrameCallbacks).toHaveLength(0);
      expect(timeoutCallbacks).toHaveLength(1);

      resizeObservers[0].callback();
      expect(animationFrameCallbacks).toHaveLength(1);
      expect(parentWindow.postMessage).toHaveBeenCalledTimes(1);

      animationFrameCallbacks.shift()(0);
      expect(parentWindow.postMessage).toHaveBeenCalledTimes(2);

      view.rerender({ ...props, aiModalLoading: true });
      await flush();
      expect(parentWindow.postMessage).toHaveBeenCalledTimes(3);
      expect(resizeObservers).toHaveLength(2);
      expect(timeoutCallbacks).toHaveLength(2);

      timeoutCallbacks[1]();
      expect(parentWindow.postMessage).toHaveBeenCalledTimes(4);

      view.unmount();
      expect(resizeObservers[0].disconnect).toHaveBeenCalledTimes(1);
      expect(resizeObservers[1].disconnect).toHaveBeenCalledTimes(1);
      expect(clearTimeout).toHaveBeenCalledTimes(2);
    } finally {
      Object.defineProperty(window, 'parent', { configurable: true, value: originalParent });
      global.ResizeObserver = originalResizeObserver;
      requestAnimationFrame.mockRestore();
      cancelAnimationFrame.mockRestore();
      setTimeout.mockRestore();
      clearTimeout.mockRestore();
      getBoundingClientRect.mockRestore();
    }
  });

  it('shows animated resummarize loading state while summary refresh is active', async () => {
    const props = createProps({ aiSummaryRefreshing: true });
    const view = mount(props);
    await flush();

    const refreshButton = view.container.querySelector('.pane-resummarize-btn');
    expect(refreshButton).toBeTruthy();
    expect(refreshButton.classList.contains('is-loading')).toBe(true);
    expect(refreshButton.getAttribute('aria-busy')).toBe('true');
    expect(refreshButton.disabled).toBe(true);
    expect(refreshButton.textContent).toContain('Re-summarizing...');
    expect(refreshButton.querySelector('.pane-btn-spinner')).toBeTruthy();

    view.unmount();
  });

  it('enhances summary table and supports sorting cycle', async () => {
    const props = createProps();
    const view = mount(props);
    await flush();

    const tableWrap = view.container.querySelector('.ai-summary .ai-table-scroll-wrap');
    const table = view.container.querySelector('.ai-summary table');
    const headers = table.querySelectorAll('th');
    expect(tableWrap).toBeTruthy();
    expect(table.dataset.aiResizableReady).toBe('true');
    expect(headers[0].querySelector('.ai-table-col-resizer')).toBeTruthy();
    expect(headers[0].querySelector('.ai-table-sort-indicator')?.textContent).toBe('↕');

    const getFirstScore = () => table.querySelector('tbody tr td')?.textContent?.trim();
    expect(getFirstScore()).toBe('20');

    act(() => {
      headers[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(getFirstScore()).toBe('3');
    expect(headers[0].dataset.sort).toBe('asc');
    expect(headers[0].querySelector('.ai-table-sort-indicator')?.textContent).toBe('↑');

    act(() => {
      headers[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(getFirstScore()).toBe('20');
    expect(headers[0].dataset.sort).toBe('desc');
    expect(headers[0].querySelector('.ai-table-sort-indicator')?.textContent).toBe('↓');

    act(() => {
      headers[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(getFirstScore()).toBe('20');
    expect(headers[0].dataset.sort).toBeUndefined();
    expect(headers[0].querySelector('.ai-table-sort-indicator')?.textContent).toBe('↕');

    view.unmount();
  });

  it('handles chips, conversation rendering, and follow-up actions', async () => {
    const props = createProps();
    const view = mount(props);
    await flush();

    expect(props.buildConfluenceUrl).toHaveBeenCalledWith('https://example.atlassian.net/wiki', '/pages/123');
    expect(view.container.textContent).toContain('Type: blogpost');
    expect(view.container.textContent).toContain('Space: Engineering');
    expect(view.container.textContent).toContain('Contributor: Alex');
    const modelSelect = view.container.querySelector('#ai-model-modal');
    expect(modelSelect?.getAttribute('data-value')).toBe('gpt-5.5');

    const avatars = view.container.querySelectorAll('.ai-chip-avatar');
    act(() => {
      avatars[0].dispatchEvent(new Event('error'));
      avatars[1].dispatchEvent(new Event('error'));
    });
    expect(avatars[0].getAttribute('src')).toBe('space-fallback');
    expect(avatars[1].getAttribute('src')).toBe('user-fallback');

    expect(view.container.textContent).toContain('rtl text');
    expect(view.container.textContent).toContain('assistant final');
    expect(props.detectDirection).toHaveBeenCalledWith('rtl text');
    expect(props.detectDirectionFromHtml).toHaveBeenCalledWith('<p>assistant final</p>');
    expect(props.sanitizeHtmlFragment).toHaveBeenCalledWith('<p>assistant final</p>');

    const summaryFontButtons = view.container.querySelectorAll('.ai-summary-panel .pane-font-btn');
    const chatFontButtons = view.container.querySelectorAll('.ai-chat-panel .pane-font-btn');
    const textarea = view.container.querySelector('.ai-question-row textarea');
    const askButton = view.container.querySelector('.ai-action-btn');
    const paneResizer = view.container.querySelector('.ai-pane-resizer');
    const questionResize = view.container.querySelector('.ai-question-resize-handle');
    const summaryToggleButton = Array.from(view.container.querySelectorAll('.ai-visibility-controls button'))
      .find((button) => button.textContent.trim() === 'Summary');
    const chatToggleButton = Array.from(view.container.querySelectorAll('.ai-visibility-controls button'))
      .find((button) => button.textContent.trim() === 'Chat');
    expect(summaryToggleButton).toBeTruthy();
    expect(chatToggleButton).toBeTruthy();
    expect(summaryToggleButton.classList.contains('is-selected')).toBe(true);
    expect(chatToggleButton.classList.contains('is-selected')).toBe(true);

    textarea.value = 'next question';
    act(() => {
      modelSelect.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const modelOption = view.container.querySelector('.ai-model-select-option[data-value="gpt-5.3-codex"]');
    expect(modelOption).toBeTruthy();
    act(() => {
      modelOption.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      view.container.querySelector('.pane-resummarize-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      view.container.querySelector('.pane-clear-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      summaryFontButtons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      summaryFontButtons[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      chatFontButtons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      chatFontButtons[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      summaryToggleButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      chatToggleButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      paneResizer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      paneResizer.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      questionResize.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      questionResize.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
      askButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(props.resummarizeActiveItem).toHaveBeenCalledTimes(1);
    expect(props.changeAiModel).toHaveBeenCalledWith('gpt-5.3-codex');
    expect(props.clearAiConversation).toHaveBeenCalledTimes(1);
    expect(props.adjustAiSummaryFontSize).toHaveBeenCalledWith(-1);
    expect(props.adjustAiSummaryFontSize).toHaveBeenCalledWith(1);
    expect(props.adjustAiChatFontSize).toHaveBeenCalledWith(-1);
    expect(props.adjustAiChatFontSize).toHaveBeenCalledWith(1);
    expect(props.toggleChatPane).toHaveBeenCalledTimes(1);
    expect(props.toggleSummaryPane).toHaveBeenCalledTimes(1);
    expect(props.startAiPaneResize).toHaveBeenCalledTimes(1);
    expect(props.resetAiSummaryPaneRatio).toHaveBeenCalledTimes(1);
    expect(props.startAiQuestionInputResize).toHaveBeenCalledTimes(1);
    expect(props.resetAiQuestionInputHeight).toHaveBeenCalledTimes(1);
    expect(props.setAiQuestion).toHaveBeenCalledWith('next question');
    expect(props.submitAiQuestion).toHaveBeenCalledTimes(2);

    view.rerender(createProps({
      isAiSummaryCollapsed: true,
      isAiChatCollapsed: false,
    }));
    await flush();
    expect(view.container.querySelector('.ai-pane-resizer')).toBeFalsy();
    const summaryToggleAfterCollapse = Array.from(view.container.querySelectorAll('.ai-visibility-controls button'))
      .find((button) => button.textContent.trim() === 'Summary');
    const chatToggleAfterCollapse = Array.from(view.container.querySelectorAll('.ai-visibility-controls button'))
      .find((button) => button.textContent.trim() === 'Chat');
    expect(summaryToggleAfterCollapse.classList.contains('is-selected')).toBe(false);
    expect(chatToggleAfterCollapse.classList.contains('is-selected')).toBe(true);

    view.unmount();
  });
});
