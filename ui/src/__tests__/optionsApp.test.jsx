import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OptionsApp } from '../optionsApp.jsx';
import { CONVERSATION_STORE, DEFAULT_AI_MODEL, SUMMARY_STORE } from '../shared/constants.js';

const serviceMocks = vi.hoisted(() => ({
  clearObjectStores: vi.fn(),
  requestOriginsPermission: vi.fn(),
  getChrome: vi.fn(),
  getLocal: vi.fn(),
  getSync: vi.fn(),
  setLocal: vi.fn(),
  setSync: vi.fn(),
  subscribeStorageChanges: vi.fn(),
}));

vi.mock('../services/indexedDb.js', () => ({
  clearObjectStores: serviceMocks.clearObjectStores,
}));

vi.mock('../services/permissions.js', () => ({
  requestOriginsPermission: serviceMocks.requestOriginsPermission,
}));

vi.mock('../services/storage.js', () => ({
  getChrome: serviceMocks.getChrome,
  getLocal: serviceMocks.getLocal,
  getSync: serviceMocks.getSync,
  setLocal: serviceMocks.setLocal,
  setSync: serviceMocks.setSync,
  subscribeStorageChanges: serviceMocks.subscribeStorageChanges,
}));

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    render(h(OptionsApp), container);
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

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function flushMany(count = 5) {
  for (let i = 0; i < count; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await flush();
  }
}

describe('OptionsApp', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    serviceMocks.clearObjectStores.mockResolvedValue(undefined);
    serviceMocks.requestOriginsPermission.mockResolvedValue({ granted: true });
    serviceMocks.getSync.mockResolvedValue({});
    serviceMocks.getLocal.mockResolvedValue({});
    serviceMocks.setLocal.mockResolvedValue({ ok: true, error: '' });
    serviceMocks.setSync.mockResolvedValue({ ok: true, error: '' });
    serviceMocks.subscribeStorageChanges.mockReturnValue(() => {});
    serviceMocks.getChrome.mockReturnValue({
      runtime: {
        sendMessage: vi.fn(),
      },
    });
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  });

  afterEach(() => {
    document.body.classList.remove('dark-mode');
  });

  it('loads persisted settings, migrates API key, and normalizes retired model', async () => {
    serviceMocks.getSync.mockResolvedValue({
      domainSettings: [{ domain: 'example.atlassian.net' }],
      darkMode: true,
      showTooltips: false,
      enableAiFeatures: true,
      enableSummaries: true,
      enableFloatingSummarize: true,
      selectedAiModel: 'gpt-4o',
      floatingPrimaryAction: 'summarize',
      useHighReasoningEffort: true,
      openaiApiKey: 'sync-api-key',
    });
    serviceMocks.getLocal.mockResolvedValue({
      customUserPrompt: 'Be concise',
      openaiApiKey: '',
    });

    const view = mount();
    await flushMany();

    expect(view.container.textContent).toContain('Extension Options');
    expect(document.body.classList.contains('dark-mode')).toBe(true);

    const modelSelect = view.container.querySelector('#ai-model');
    const reasoningSelect = view.container.querySelector('#reasoning-effort');
    const floatingPrimaryActionSelect = view.container.querySelector('#floating-primary-action');
    const domainInput = view.container.querySelector('input[placeholder="example.com"]');

    expect(modelSelect?.value).toBe(DEFAULT_AI_MODEL);
    expect(reasoningSelect?.value).toBe('high');
    expect(floatingPrimaryActionSelect?.value).toBe('summarize');
    expect(domainInput?.value).toBe('example.atlassian.net');

    expect(serviceMocks.setLocal).toHaveBeenCalledWith({ openaiApiKey: 'sync-api-key' });
    expect(serviceMocks.setSync).toHaveBeenCalledWith({ selectedAiModel: DEFAULT_AI_MODEL });
    expect(serviceMocks.setSync).toHaveBeenCalledWith({ openaiApiKey: '' });

    view.unmount();
  });

  it('validates and saves settings with a combined permission check', async () => {
    serviceMocks.requestOriginsPermission
      .mockResolvedValueOnce({ granted: false, reason: 'permissions_api_unavailable' })
      .mockResolvedValueOnce({ granted: true });

    const view = mount();
    await flushMany();

    const domainInput = view.container.querySelector('input[placeholder="example.com"]');
    const saveButton = Array.from(view.container.querySelectorAll('button')).find((button) => button.textContent.includes('Save Settings'));
    expect(domainInput).toBeTruthy();
    expect(saveButton).toBeTruthy();

    act(() => {
      saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMany();
    expect(view.container.textContent).toContain('Add at least one Confluence domain before saving.');
    expect(serviceMocks.requestOriginsPermission).not.toHaveBeenCalled();

    domainInput.value = 'not-a-domain';
    act(() => {
      domainInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flushMany();
    act(() => {
      saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMany();
    expect(view.container.textContent).toContain('Invalid domain.');
    expect(serviceMocks.requestOriginsPermission).not.toHaveBeenCalled();

    domainInput.value = 'https://example.atlassian.net/wiki';
    act(() => {
      domainInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flushMany();
    act(() => {
      saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMany();
    expect(view.container.textContent).toContain('Permissions API is unavailable');

    act(() => {
      saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMany();
    expect(serviceMocks.requestOriginsPermission).toHaveBeenCalledWith(
      ['*://example.atlassian.net/*', 'https://api.openai.com/*'],
    );
    expect(serviceMocks.setSync).toHaveBeenCalledWith({
      domainSettings: [{ domain: 'example.atlassian.net' }],
      customApiEndpoint: '',
    });
    expect(view.container.textContent).toContain('Settings saved');

    view.unmount();
  });

  it('shows default endpoint warning once and missing API key warning on every save when AI is enabled', async () => {
    const view = mount();
    await flushMany();

    const domainInput = view.container.querySelector('input[placeholder="example.com"]');
    const aiToggle = view.container.querySelector('#enable-ai-features');
    const saveButton = Array.from(view.container.querySelectorAll('button')).find((button) => button.textContent.includes('Save Settings'));
    expect(domainInput).toBeTruthy();
    expect(aiToggle).toBeTruthy();
    expect(saveButton).toBeTruthy();

    domainInput.value = 'confluence.example.com';
    act(() => {
      domainInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flushMany();

    aiToggle.checked = true;
    act(() => {
      aiToggle.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushMany();

    act(() => {
      saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMany();

    const firstStatuses = Array.from(view.container.querySelectorAll('.status-floating'));
    expect(firstStatuses).toHaveLength(2);
    expect(firstStatuses.some((node) => node.classList.contains('warning'))).toBe(true);
    expect(firstStatuses.some((node) => node.classList.contains('error'))).toBe(true);
    expect(view.container.textContent).toContain('No custom OpenAI API Base URL is set');
    expect(view.container.textContent).toContain('OpenAI API Key is empty');
    expect(serviceMocks.setLocal).toHaveBeenCalledWith({ defaultEndpointWarningShown: true });

    act(() => {
      saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMany();

    const secondStatuses = Array.from(view.container.querySelectorAll('.status-floating'));
    expect(secondStatuses).toHaveLength(1);
    expect(secondStatuses[0]?.classList.contains('error')).toBe(true);
    expect(view.container.textContent).not.toContain('No custom OpenAI API Base URL is set');
    expect(view.container.textContent).toContain('OpenAI API Key is empty');

    view.unmount();
  });

  it('handles endpoint validation and permission outcomes in Save Settings flow', async () => {
    serviceMocks.requestOriginsPermission
      .mockResolvedValueOnce({ granted: false, reason: 'request_failed' })
      .mockResolvedValueOnce({ granted: true });

    const view = mount();
    await flushMany();

    const domainInput = view.container.querySelector('input[placeholder="example.com"]');
    const aiToggle = view.container.querySelector('#enable-ai-features');
    const saveButton = Array.from(view.container.querySelectorAll('button')).find((button) => button.textContent.includes('Save Settings'));
    expect(domainInput).toBeTruthy();
    expect(aiToggle).toBeTruthy();
    expect(saveButton).toBeTruthy();

    domainInput.value = 'confluence.example.com';
    act(() => {
      domainInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flushMany();

    aiToggle.checked = true;
    act(() => {
      aiToggle.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushMany();

    const apiKeyInput = view.container.querySelector('#api-key');
    const endpointInput = view.container.querySelector('#custom-endpoint');
    expect(apiKeyInput).toBeTruthy();
    expect(endpointInput).toBeTruthy();

    apiKeyInput.value = 'sk-test-key';
    act(() => {
      apiKeyInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flushMany();

    endpointInput.value = 'bad url value';
    act(() => {
      endpointInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flushMany();
    act(() => {
      saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMany();
    expect(view.container.textContent).toContain('Invalid custom OpenAI API Base URL.');
    expect(serviceMocks.requestOriginsPermission).not.toHaveBeenCalled();

    endpointInput.value = 'https://custom.openai.example/v1';
    act(() => {
      endpointInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flushMany();
    act(() => {
      saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMany();
    expect(view.container.textContent).toContain('Could not request required permissions.');
    expect(serviceMocks.requestOriginsPermission).toHaveBeenCalledWith(
      ['*://confluence.example.com/*', 'https://custom.openai.example/*'],
    );

    act(() => {
      saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMany();
    expect(serviceMocks.setSync).toHaveBeenCalledWith({
      domainSettings: [{ domain: 'confluence.example.com' }],
      customApiEndpoint: 'https://custom.openai.example/v1',
    });
    expect(view.container.textContent).toContain('Settings saved');

    view.unmount();
  });

  it('tests OpenAI API key against configured/default endpoint', async () => {
    const runtimeSendMessage = vi.fn((_message, callback) => {
      callback?.({ ok: true, valid: true });
    });
    serviceMocks.getChrome.mockReturnValue({
      runtime: {
        sendMessage: runtimeSendMessage,
      },
    });

    const view = mount();
    await flushMany();

    const aiToggle = view.container.querySelector('#enable-ai-features');
    expect(aiToggle).toBeTruthy();
    aiToggle.checked = true;
    act(() => {
      aiToggle.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushMany();

    const apiKeyInput = view.container.querySelector('#api-key');
    expect(apiKeyInput).toBeTruthy();
    apiKeyInput.value = 'sk-test-key';
    act(() => {
      apiKeyInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flushMany();

    const testButton = view.container.querySelector('.inline-action-btn');
    expect(testButton).toBeTruthy();
    expect(testButton?.textContent).toBe('Test');
    act(() => {
      testButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMany();

    expect(runtimeSendMessage).toHaveBeenCalledWith(
      {
        action: 'validateOpenAiApiKey',
        apiKey: 'sk-test-key',
        apiUrl: 'https://api.openai.com/v1',
      },
      expect.any(Function),
    );
    expect(view.container.textContent).toContain('OpenAI API key is valid');
    expect(testButton?.textContent).toBe('✓');
    expect(testButton?.classList.contains('inline-action-btn--success')).toBe(true);

    const endpointInput = view.container.querySelector('#custom-endpoint');
    expect(endpointInput).toBeTruthy();
    endpointInput.value = 'https://custom.openai.example/v1';
    act(() => {
      endpointInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flushMany();

    expect(testButton?.textContent).toBe('Test');
    expect(testButton?.classList.contains('inline-action-btn--success')).toBe(false);
    expect(testButton?.classList.contains('inline-action-btn--error')).toBe(false);

    apiKeyInput.value = 'sk-test-key-updated';
    act(() => {
      apiKeyInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flushMany();

    expect(testButton?.textContent).toBe('Test');

    view.unmount();
  });

  it('shows failed API key test state and resets on edits', async () => {
    const runtimeSendMessage = vi.fn((_message, callback) => {
      callback?.({ ok: true, valid: false, error: 'Invalid API key' });
    });
    serviceMocks.getChrome.mockReturnValue({
      runtime: {
        sendMessage: runtimeSendMessage,
      },
    });

    const view = mount();
    await flushMany();

    const aiToggle = view.container.querySelector('#enable-ai-features');
    expect(aiToggle).toBeTruthy();
    aiToggle.checked = true;
    act(() => {
      aiToggle.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushMany();

    const apiKeyInput = view.container.querySelector('#api-key');
    expect(apiKeyInput).toBeTruthy();
    apiKeyInput.value = 'sk-invalid-key';
    act(() => {
      apiKeyInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flushMany();

    const testButton = view.container.querySelector('.inline-action-btn');
    expect(testButton).toBeTruthy();
    act(() => {
      testButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMany();

    expect(runtimeSendMessage).toHaveBeenCalled();
    expect(view.container.textContent).toContain('OpenAI API key appears invalid');
    expect(testButton?.textContent).toBe('✕');
    expect(testButton?.classList.contains('inline-action-btn--error')).toBe(true);

    apiKeyInput.value = 'sk-fixed-key';
    act(() => {
      apiKeyInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flushMany();

    expect(testButton?.textContent).toBe('Test');
    expect(testButton?.classList.contains('inline-action-btn--error')).toBe(false);

    view.unmount();
  });

  it('persists floating primary action selection', async () => {
    serviceMocks.getSync.mockResolvedValue({
      enableAiFeatures: true,
      enableSummaries: true,
      enableFloatingSummarize: true,
      floatingPrimaryAction: 'summarize',
    });
    const view = mount();
    await flushMany();

    const floatingPrimaryActionSelect = view.container.querySelector('#floating-primary-action');
    expect(floatingPrimaryActionSelect).toBeTruthy();
    expect(floatingPrimaryActionSelect?.value).toBe('summarize');

    floatingPrimaryActionSelect.value = 'search';
    act(() => {
      floatingPrimaryActionSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushMany();

    expect(serviceMocks.setSync).toHaveBeenCalledWith({ floatingPrimaryAction: 'search' });
    view.unmount();
  });

  it('toggles AI settings visibility via Enable AI Features', async () => {
    const view = mount();
    await flushMany();

    const sectionHeadings = Array.from(view.container.querySelectorAll('h2')).map((node) => node.textContent || '');
    const aiHeadingIndex = sectionHeadings.findIndex((text) => text.startsWith('AI Options'));
    const additionalOptionsHeadingIndex = sectionHeadings.findIndex((text) => text.startsWith('Additional Options'));
    const domainHeadingText = sectionHeadings.find((text) => text.startsWith('Domain Options')) || '';
    expect(aiHeadingIndex).toBeGreaterThan(-1);
    expect(additionalOptionsHeadingIndex).toBeGreaterThan(-1);
    expect(aiHeadingIndex).toBeLessThan(additionalOptionsHeadingIndex);
    expect(domainHeadingText).toContain('Required');

    const aiToggle = view.container.querySelector('#enable-ai-features');
    expect(aiToggle).toBeTruthy();
    expect(view.container.querySelector('#api-key')).toBeNull();

    aiToggle.checked = true;
    act(() => {
      aiToggle.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushMany();

    expect(view.container.querySelector('#api-key')).toBeTruthy();
    expect(view.container.textContent).toContain('Optional');
    const floatingPrimaryActionSelect = view.container.querySelector('#floating-primary-action');
    expect(floatingPrimaryActionSelect?.value).toBe('search');
    expect(serviceMocks.setSync).toHaveBeenCalledWith({
      enableAiFeatures: true,
      enableSummaries: true,
      enableFloatingSummarize: true,
    });

    aiToggle.checked = false;
    act(() => {
      aiToggle.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushMany();

    expect(view.container.querySelector('#api-key')).toBeNull();
    expect(serviceMocks.setSync).toHaveBeenCalledWith({
      enableAiFeatures: false,
      enableSummaries: false,
      enableFloatingSummarize: true,
      floatingPrimaryAction: 'search',
    });

    view.unmount();
  });

  it('warns before unload when settings were changed without Save Settings', async () => {
    const view = mount();
    await flushMany();

    const treeTooltipToggle = view.container.querySelector('#tree-tooltips');
    expect(treeTooltipToggle).toBeTruthy();

    treeTooltipToggle.checked = false;
    act(() => {
      treeTooltipToggle.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushMany();

    const beforeUnloadEvent = new Event('beforeunload', { cancelable: true });
    Object.defineProperty(beforeUnloadEvent, 'returnValue', { writable: true, value: '' });
    window.dispatchEvent(beforeUnloadEvent);

    expect(beforeUnloadEvent.defaultPrevented).toBe(true);

    view.unmount();
  });

  it('does not mark settings as unsaved when toggling theme in the header', async () => {
    const view = mount();
    await flushMany();

    const themeToggleButton = view.container.querySelector('#theme-toggle-btn');
    expect(themeToggleButton).toBeTruthy();

    act(() => {
      themeToggleButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMany();

    expect(document.body.classList.contains('dark-mode')).toBe(true);
    expect(serviceMocks.setSync).toHaveBeenCalledWith({ darkMode: true });

    const beforeUnloadEvent = new Event('beforeunload', { cancelable: true });
    Object.defineProperty(beforeUnloadEvent, 'returnValue', { writable: true, value: '' });
    window.dispatchEvent(beforeUnloadEvent);

    expect(beforeUnloadEvent.defaultPrevented).toBe(false);

    view.unmount();
  });

  it('syncs the header theme toggle from sync storage changes', async () => {
    let onStorageChange = null;
    serviceMocks.subscribeStorageChanges.mockImplementation((listener) => {
      onStorageChange = listener;
      return () => {};
    });

    const view = mount();
    await flushMany();

    expect(document.body.classList.contains('dark-mode')).toBe(false);
    expect(onStorageChange).toBeTypeOf('function');

    act(() => {
      onStorageChange({ darkMode: { newValue: true } }, 'sync');
    });
    await flushMany();

    expect(document.body.classList.contains('dark-mode')).toBe(true);
    const themeToggleButton = view.container.querySelector('#theme-toggle-btn');
    expect(themeToggleButton?.getAttribute('title')).toBe('Switch to light mode');

    view.unmount();
  });

  it('confirms and clears summaries plus conversations', async () => {
    const runtimeSendMessage = vi.fn();
    serviceMocks.getChrome.mockReturnValue({
      runtime: {
        sendMessage: runtimeSendMessage,
      },
    });

    const view = mount();
    await flushMany();

    const aiToggle = view.container.querySelector('#enable-ai-features');
    expect(aiToggle).toBeTruthy();
    aiToggle.checked = true;
    act(() => {
      aiToggle.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushMany();

    const clearAllButton = Array.from(view.container.querySelectorAll('button')).find((button) => button.textContent.includes('Summaries + Conversations'));
    expect(clearAllButton).toBeTruthy();

    act(() => {
      clearAllButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMany();
    expect(view.container.textContent).toContain('Delete all summaries and conversations?');

    const confirmDeleteButton = Array.from(view.container.querySelectorAll('.dialog-actions button'))
      .find((button) => button.textContent.includes('Delete All'));
    expect(confirmDeleteButton).toBeTruthy();

    act(() => {
      confirmDeleteButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMany();

    expect(serviceMocks.clearObjectStores).toHaveBeenCalledWith(expect.objectContaining({
      stores: [SUMMARY_STORE, CONVERSATION_STORE],
      onUpgradeNeeded: expect.any(Function),
    }));
    expect(runtimeSendMessage).toHaveBeenCalledWith({ action: 'summariesCleared' });
    expect(view.container.textContent).toContain('All summaries and follow-up conversations cleared.');

    view.unmount();
  });
});
