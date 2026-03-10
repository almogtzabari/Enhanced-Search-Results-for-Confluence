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

  it('validates and saves domains with permission checks', async () => {
    serviceMocks.requestOriginsPermission
      .mockResolvedValueOnce({ granted: false, reason: 'permissions_api_unavailable' })
      .mockResolvedValueOnce({ granted: true });

    const view = mount();
    await flushMany();

    const domainInput = view.container.querySelector('input[placeholder="example.com"]');
    const saveButton = Array.from(view.container.querySelectorAll('button')).find((button) => button.textContent.includes('Save Domain Settings'));
    expect(domainInput).toBeTruthy();
    expect(saveButton).toBeTruthy();

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

    domainInput.value = 'example.atlassian.net';
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
    expect(serviceMocks.requestOriginsPermission).toHaveBeenCalledWith(['*://example.atlassian.net/*']);
    expect(serviceMocks.setSync).toHaveBeenCalledWith({ domainSettings: [{ domain: 'example.atlassian.net' }] });
    expect(view.container.textContent).toContain('Domain settings saved.');

    view.unmount();
  });

  it('handles endpoint permission errors and success', async () => {
    serviceMocks.requestOriginsPermission
      .mockResolvedValueOnce({ granted: false, reason: 'request_failed' })
      .mockResolvedValueOnce({ granted: true });

    const view = mount();
    await flushMany();

    const endpointInput = view.container.querySelector('#custom-endpoint');
    const grantButton = Array.from(view.container.querySelectorAll('button')).find((button) => button.textContent.includes('Grant Endpoint Permission'));
    expect(endpointInput).toBeTruthy();
    expect(grantButton).toBeTruthy();

    endpointInput.value = 'bad url value';
    act(() => {
      endpointInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flushMany();
    act(() => {
      grantButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMany();
    expect(view.container.textContent).toContain('Invalid OpenAI endpoint URL.');

    endpointInput.value = 'https://custom.openai.example/v1';
    act(() => {
      endpointInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flushMany();
    act(() => {
      grantButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMany();
    expect(view.container.textContent).toContain('Could not request endpoint permission.');
    expect(serviceMocks.requestOriginsPermission).toHaveBeenCalledWith(['https://custom.openai.example/*']);

    act(() => {
      grantButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushMany();
    expect(view.container.textContent).toContain('Endpoint permission granted for https://custom.openai.example.');

    view.unmount();
  });

  it('persists floating primary action selection', async () => {
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

  it('confirms and clears summaries plus conversations', async () => {
    const runtimeSendMessage = vi.fn();
    serviceMocks.getChrome.mockReturnValue({
      runtime: {
        sendMessage: runtimeSendMessage,
      },
    });

    const view = mount();
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
