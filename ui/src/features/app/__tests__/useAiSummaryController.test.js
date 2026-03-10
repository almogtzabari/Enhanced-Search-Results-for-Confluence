import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountHook } from '../../../test/hookTestUtils.js';
import { useAiSummaryController } from '../controllers/useAiSummaryController.js';

const storageMocks = vi.hoisted(() => ({
  getLocal: vi.fn(),
}));

const dbMocks = vi.hoisted(() => ({
  getStoredConversation: vi.fn(),
  getStoredSummary: vi.fn(),
  storeConversation: vi.fn(),
  storeSummary: vi.fn(),
}));

const aiRuntimeMocks = vi.hoisted(() => ({
  getAiRuntimeSettings: vi.fn(),
  sendOpenAIRequest: vi.fn(),
  withTimeout: vi.fn(),
}));

const confluenceApiMocks = vi.hoisted(() => ({
  enrichVisualMetadata: vi.fn(),
  fetchConfluenceBodyById: vi.fn(),
  fetchConfluenceMetadataById: vi.fn(),
  fetchImageDataUrlViaHostBridge: vi.fn(),
}));

vi.mock('../../../services/storage.js', () => ({
  getLocal: storageMocks.getLocal,
}));

vi.mock('../../../services/dbClient.js', () => ({
  getStoredConversation: dbMocks.getStoredConversation,
  getStoredSummary: dbMocks.getStoredSummary,
  storeConversation: dbMocks.storeConversation,
  storeSummary: dbMocks.storeSummary,
}));

vi.mock('../../../services/aiRuntime.js', () => ({
  getAiRuntimeSettings: aiRuntimeMocks.getAiRuntimeSettings,
  sendOpenAIRequest: aiRuntimeMocks.sendOpenAIRequest,
  withTimeout: aiRuntimeMocks.withTimeout,
}));

vi.mock('../../../services/confluenceApi.js', () => ({
  enrichVisualMetadata: confluenceApiMocks.enrichVisualMetadata,
  fetchConfluenceBodyById: confluenceApiMocks.fetchConfluenceBodyById,
  fetchConfluenceMetadataById: confluenceApiMocks.fetchConfluenceMetadataById,
  fetchImageDataUrlViaHostBridge: confluenceApiMocks.fetchImageDataUrlViaHostBridge,
}));

function defaultPageData(id, overrides = {}) {
  return {
    id,
    title: `Page ${id}`,
    type: 'page',
    _links: { webui: `/pages/${id}` },
    space: {},
    history: { createdBy: {} },
    version: {},
    ancestors: [],
    ...overrides,
  };
}

function createHook(overrides = {}) {
  return mountHook(useAiSummaryController, {
    baseUrl: 'https://example.atlassian.net/wiki',
    modalOnlyMode: false,
    modalContentId: '',
    modalContentTitle: '',
    enableSummaries: true,
    allResults: [],
    openNoticeDialog: vi.fn(),
    openConfirmDialog: vi.fn(async () => true),
    ...overrides,
  });
}

describe('useAiSummaryController', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    storageMocks.getLocal.mockReset();
    dbMocks.getStoredConversation.mockReset();
    dbMocks.getStoredSummary.mockReset();
    dbMocks.storeConversation.mockReset();
    dbMocks.storeSummary.mockReset();
    aiRuntimeMocks.getAiRuntimeSettings.mockReset();
    aiRuntimeMocks.sendOpenAIRequest.mockReset();
    aiRuntimeMocks.withTimeout.mockReset();
    confluenceApiMocks.enrichVisualMetadata.mockReset();
    confluenceApiMocks.fetchConfluenceBodyById.mockReset();
    confluenceApiMocks.fetchConfluenceMetadataById.mockReset();
    confluenceApiMocks.fetchImageDataUrlViaHostBridge.mockReset();

    storageMocks.getLocal.mockResolvedValue({});
    dbMocks.getStoredConversation.mockResolvedValue(null);
    dbMocks.getStoredSummary.mockResolvedValue(null);
    dbMocks.storeConversation.mockResolvedValue();
    dbMocks.storeSummary.mockResolvedValue();
    aiRuntimeMocks.getAiRuntimeSettings.mockResolvedValue({
      apiKey: 'k',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      reasoningEffort: undefined,
    });
    aiRuntimeMocks.sendOpenAIRequest.mockResolvedValue({ output_text: '<p>generated</p>' });
    aiRuntimeMocks.withTimeout.mockImplementation(async (promise) => promise);
    confluenceApiMocks.enrichVisualMetadata.mockImplementation(async (_base, data) => data);
    confluenceApiMocks.fetchConfluenceBodyById.mockResolvedValue('<p>body</p>');
    confluenceApiMocks.fetchConfluenceMetadataById.mockResolvedValue({});
    confluenceApiMocks.fetchImageDataUrlViaHostBridge.mockResolvedValue('');
  });

  it('marks stored summaries as ready for loaded result ids', async () => {
    dbMocks.getStoredSummary.mockImplementation(async (id) => (id === '10' ? { summaryHtml: '<p>x</p>' } : null));

    const hook = createHook({
      allResults: [{ id: '10', ancestors: [] }],
    });

    await hook.flush();
    await hook.flush();

    expect(hook.result.state.aiSummaryStatusById['10']).toBe('ready');
    hook.unmount();
  });

  it('shows a notice and stops when summaries are disabled', async () => {
    const openNoticeDialog = vi.fn();
    const hook = createHook({
      enableSummaries: false,
      openNoticeDialog,
    });

    await hook.result.actions.openAiSummaryModal(defaultPageData('11'));
    await hook.flush();

    expect(openNoticeDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: 'AI Summaries Disabled',
      tone: 'info',
    }));
    expect(aiRuntimeMocks.getAiRuntimeSettings).not.toHaveBeenCalled();
    expect(hook.result.state.aiModalOpen).toBe(false);
    hook.unmount();
  });

  it('uses cached summary without calling OpenAI', async () => {
    dbMocks.getStoredSummary.mockImplementation(async (id) => (
      id === '42'
        ? { summaryHtml: '<p>cached summary</p>', userPrompt: 'cached prompt' }
        : null
    ));

    const hook = createHook();
    await hook.result.actions.openAiSummaryModal(defaultPageData('42'));
    await hook.flush();
    await hook.flush();

    expect(aiRuntimeMocks.sendOpenAIRequest).not.toHaveBeenCalled();
    expect(dbMocks.storeSummary).not.toHaveBeenCalled();
    expect(hook.result.state.aiSummaryStatusById['42']).toBe('ready');
    expect(hook.result.state.aiSummaryHtml).toContain('cached summary');
    hook.unmount();
  });

  it('shows a failure notice when OpenAI summary request fails', async () => {
    const openNoticeDialog = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    aiRuntimeMocks.sendOpenAIRequest.mockRejectedValueOnce(new Error('OpenAI offline'));

    const hook = createHook({ openNoticeDialog });
    await hook.result.actions.openAiSummaryModal(defaultPageData('99'));
    await hook.flush();
    await hook.flush();

    expect(aiRuntimeMocks.sendOpenAIRequest).toHaveBeenCalled();
    expect(openNoticeDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Failed to Summarize Page',
      message: 'OpenAI offline',
      tone: 'error',
    }));
    expect(hook.result.state.aiSummaryStatusById['99']).toBe('idle');
    hook.unmount();
  });

  it('posts close message to host when closing modal-only runtime', async () => {
    dbMocks.getStoredSummary.mockImplementation(async (id) => (
      id === '7'
        ? { summaryHtml: '<p>cached</p>', userPrompt: 'prompt' }
        : null
    ));
    const parentPostMessage = vi.fn();
    Object.defineProperty(window, 'parent', {
      value: { postMessage: parentPostMessage },
      configurable: true,
    });

    const hook = createHook({ modalOnlyMode: true });
    await hook.result.actions.openAiSummaryModal(defaultPageData('7'));
    await hook.flush();

    hook.result.actions.closeAiModal();
    expect(parentPostMessage).toHaveBeenCalledWith(
      { type: 'enhanced-ai-modal-close' },
      'https://example.atlassian.net',
    );

    Object.defineProperty(window, 'parent', {
      value: window,
      configurable: true,
    });
    hook.unmount();
  });

  it('uses host bridge to replace icon urls in modal-only runtime', async () => {
    dbMocks.getStoredSummary.mockImplementation(async (id) => (
      id === '88'
        ? { summaryHtml: '<p>cached</p>', userPrompt: 'prompt' }
        : null
    ));
    confluenceApiMocks.fetchImageDataUrlViaHostBridge.mockImplementation(async (url) => (
      String(url).includes('space')
        ? 'data:image/png;base64,space'
        : 'data:image/png;base64,user'
    ));

    const hook = createHook({ modalOnlyMode: true });
    await hook.result.actions.openAiSummaryModal(defaultPageData('88', {
      space: { icon: { path: '/images/space.png' } },
      history: {
        createdBy: {
          displayName: 'Alice',
          profilePicture: { path: '/images/user.png' },
        },
      },
    }));
    await hook.flush();
    await hook.flush();
    await hook.flush();

    expect(confluenceApiMocks.fetchImageDataUrlViaHostBridge).toHaveBeenCalledWith(
      'https://example.atlassian.net/images/space.png',
      12000,
    );
    expect(confluenceApiMocks.fetchImageDataUrlViaHostBridge).toHaveBeenCalledWith(
      'https://example.atlassian.net/images/user.png',
      12000,
    );
    expect(hook.result.state.aiSpaceIconSrc).toBe('data:image/png;base64,space');
    expect(hook.result.state.aiContributorIconSrc).toBe('data:image/png;base64,user');
    hook.unmount();
  });
});
