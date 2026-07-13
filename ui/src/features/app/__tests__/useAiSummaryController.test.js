import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountHook } from '../../../test/hookTestUtils.js';
import { OPENAI_REQUEST_TIMEOUT_MS } from '../constants.js';
import { useAiSummaryController } from '../controllers/useAiSummaryController.js';

const storageMocks = vi.hoisted(() => ({
  getLocal: vi.fn(),
}));

const dbMocks = vi.hoisted(() => ({
  getAllStoredSummaries: vi.fn(),
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
  getAllStoredSummaries: dbMocks.getAllStoredSummaries,
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
    dbMocks.getAllStoredSummaries.mockReset();
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
    dbMocks.getAllStoredSummaries.mockResolvedValue([]);
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
    dbMocks.getAllStoredSummaries.mockResolvedValue([
      {
        contentId: '10',
        baseUrl: 'https://example.atlassian.net/wiki',
        summaryHtml: '<p>x</p>',
      },
    ]);

    const hook = createHook({
      allResults: [{ id: '10', ancestors: [] }],
    });

    await hook.flush();
    await hook.flush();

    expect(hook.result.state.aiSummaryStatusById['10']).toBe('ready');
    expect(dbMocks.getStoredSummary).not.toHaveBeenCalled();
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
    expect(hook.result.state.aiModalLoadingTitle).toBe('Loading your summary');
    expect(hook.result.state.aiSummaryHtml).toContain('cached summary');
    hook.unmount();
  });

  it('opens quickly from cached summary without waiting for metadata fetch', async () => {
    dbMocks.getStoredSummary.mockImplementation(async (id) => (
      id === '43'
        ? { summaryHtml: '<p>cached summary</p>', userPrompt: 'cached prompt' }
        : null
    ));

    let resolveMetadata;
    let metadataResolved = false;
    const metadataPromise = new Promise((resolve) => {
      resolveMetadata = (value) => {
        metadataResolved = true;
        resolve(value);
      };
    });
    confluenceApiMocks.fetchConfluenceMetadataById.mockReturnValue(metadataPromise);

    const hook = createHook();
    await hook.result.actions.openAiSummaryModal(defaultPageData('43'));
    await hook.flush();

    expect(metadataResolved).toBe(false);
    expect(hook.result.state.aiModalLoading).toBe(false);
    expect(hook.result.state.aiSummaryHtml).toContain('cached summary');
    expect(aiRuntimeMocks.sendOpenAIRequest).not.toHaveBeenCalled();

    resolveMetadata({});
    await hook.flush();
    hook.unmount();
  });

  it('reveals the modal-only loading shell before the stored-summary preflight finishes', async () => {
    let resolveStoredSummary;
    const storedSummaryPromise = new Promise((resolve) => {
      resolveStoredSummary = resolve;
    });
    dbMocks.getStoredSummary.mockReturnValue(storedSummaryPromise);

    const hook = createHook({ modalOnlyMode: true });
    const openPromise = hook.result.actions.openAiSummaryModal(defaultPageData('44'));
    await hook.flush();

    expect(hook.result.state.aiModalOpen).toBe(true);
    expect(hook.result.state.aiModalLoading).toBe(true);
    expect(hook.result.state.aiModalLoadingTitle).toBe('Building your summary');
    expect(hook.result.state.aiActiveItem?.id).toBe('44');
    expect(aiRuntimeMocks.getAiRuntimeSettings).not.toHaveBeenCalled();

    resolveStoredSummary({
      summaryHtml: '<p>cached after preflight</p>',
      userPrompt: 'cached prompt',
    });
    await openPromise;
    await hook.flush();

    expect(hook.result.state.aiModalLoading).toBe(false);
    expect(hook.result.state.aiModalLoadingTitle).toBe('Loading your summary');
    expect(hook.result.state.aiSummaryHtml).toContain('cached after preflight');
    hook.unmount();
  });

  it('keeps the views modal hidden until its stored-summary preflight finishes', async () => {
    let resolveStoredSummary;
    const storedSummaryPromise = new Promise((resolve) => {
      resolveStoredSummary = resolve;
    });
    dbMocks.getStoredSummary.mockReturnValue(storedSummaryPromise);

    const hook = createHook();
    const openPromise = hook.result.actions.openAiSummaryModal(defaultPageData('45'));
    await hook.flush();

    expect(hook.result.state.aiModalOpen).toBe(false);

    resolveStoredSummary({
      summaryHtml: '<p>cached views summary</p>',
      userPrompt: 'cached prompt',
    });
    await openPromise;
    await hook.flush();

    expect(hook.result.state.aiModalOpen).toBe(true);
    expect(hook.result.state.aiSummaryHtml).toContain('cached views summary');
    hook.unmount();
  });

  it('stops modal-only preflight work when the loading shell is closed', async () => {
    let resolveStoredSummary;
    const storedSummaryPromise = new Promise((resolve) => {
      resolveStoredSummary = resolve;
    });
    dbMocks.getStoredSummary.mockReturnValue(storedSummaryPromise);

    const hook = createHook({ modalOnlyMode: true });
    const openPromise = hook.result.actions.openAiSummaryModal(defaultPageData('46'));
    await hook.flush();
    expect(hook.result.state.aiModalOpen).toBe(true);

    hook.result.actions.closeAiModal();
    await hook.flush();
    resolveStoredSummary(null);
    await openPromise;
    await hook.flush();

    expect(hook.result.state.aiModalOpen).toBe(false);
    expect(aiRuntimeMocks.getAiRuntimeSettings).not.toHaveBeenCalled();
    expect(aiRuntimeMocks.sendOpenAIRequest).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('stops the modal-only loader when runtime preflight fails', async () => {
    const openNoticeDialog = vi.fn();
    aiRuntimeMocks.getAiRuntimeSettings.mockRejectedValueOnce(new Error('Endpoint permission missing'));

    const hook = createHook({ modalOnlyMode: true, openNoticeDialog });
    await hook.result.actions.openAiSummaryModal(defaultPageData('47'));
    await hook.flush();

    expect(hook.result.state.aiModalOpen).toBe(true);
    expect(hook.result.state.aiModalLoading).toBe(false);
    expect(openNoticeDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: 'AI Setup Required',
      message: 'Endpoint permission missing',
      tone: 'error',
    }));
    expect(aiRuntimeMocks.sendOpenAIRequest).not.toHaveBeenCalled();
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

  it('uses the extended request timeout for follow-up answers', async () => {
    dbMocks.getStoredSummary.mockResolvedValue({
      summaryHtml: '<p>cached summary</p>',
      userPrompt: 'cached page content',
    });
    const hook = createHook();

    await hook.result.actions.openAiSummaryModal(defaultPageData('100'));
    await hook.flush();
    hook.result.actions.setAiQuestion('Summarize this page extensively.');
    await hook.flush();
    await hook.result.actions.submitAiQuestion();
    await hook.flush();

    expect(OPENAI_REQUEST_TIMEOUT_MS).toBe(10 * 60 * 1000);
    expect(aiRuntimeMocks.withTimeout).toHaveBeenCalledWith(
      expect.any(Promise),
      OPENAI_REQUEST_TIMEOUT_MS,
      'Q&A request timed out. Please try again.',
      expect.any(Function),
    );
    expect(dbMocks.storeConversation).toHaveBeenCalledWith(
      '100',
      'https://example.atlassian.net/wiki',
      expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', content: '<p>generated</p>' }),
      ]),
    );
    hook.unmount();
  });

  it('continues summarize after closing modal without reopening or overriding closed state', async () => {
    dbMocks.getStoredSummary.mockImplementation(async (id) => (id === '5' ? null : null));

    let resolveFirstRequest;
    const firstRequestPromise = new Promise((resolve) => {
      resolveFirstRequest = (value) => resolve(value);
    });
    aiRuntimeMocks.sendOpenAIRequest.mockImplementationOnce(() => firstRequestPromise);

    const hook = createHook();
    const firstOpenPromise = hook.result.actions.openAiSummaryModal(defaultPageData('5'));
    await hook.flush();
    expect(hook.result.state.aiModalOpen).toBe(true);

    hook.result.actions.closeAiModal();
    await hook.flush();
    expect(hook.result.state.aiModalOpen).toBe(false);

    resolveFirstRequest({ output_text: '<p>finished in background</p>' });
    await firstOpenPromise;
    await hook.flush();

    expect(hook.result.state.aiModalOpen).toBe(false);
    expect(hook.result.state.aiSummaryHtml).toBe('');
    expect(hook.result.state.aiSummaryStatusById['5']).toBe('ready');
    expect(dbMocks.storeSummary).toHaveBeenCalled();
    hook.unmount();
  });

  it('does not let stale summarize request override a newer modal', async () => {
    dbMocks.getStoredSummary.mockImplementation(async (id) => (
      id === '1' ? null : { summaryHtml: '<p>ready second</p>', userPrompt: 'p2' }
    ));
    dbMocks.getStoredConversation.mockResolvedValue(null);

    let resolveFirstRequest;
    const firstRequestPromise = new Promise((resolve) => {
      resolveFirstRequest = (value) => resolve(value);
    });
    aiRuntimeMocks.sendOpenAIRequest.mockImplementationOnce(() => firstRequestPromise);

    const hook = createHook();
    const firstOpenPromise = hook.result.actions.openAiSummaryModal(defaultPageData('1'));
    await hook.flush();

    await hook.result.actions.openAiSummaryModal(defaultPageData('2'));
    await hook.flush();
    await hook.flush();
    expect(hook.result.state.aiSummaryHtml).toContain('ready second');

    resolveFirstRequest({ output_text: '<p>late first</p>' });
    await firstOpenPromise;
    await hook.flush();
    await hook.flush();

    expect(hook.result.state.aiActiveItem?.id).toBe('2');
    expect(hook.result.state.aiSummaryHtml).toContain('ready second');
    expect(hook.result.state.aiSummaryStatusById['1']).toBe('ready');
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

  it('uses contributor fallback fields when createdBy is missing', async () => {
    dbMocks.getStoredSummary.mockImplementation(async (id) => (
      id === '89'
        ? { summaryHtml: '<p>cached</p>', userPrompt: 'prompt' }
        : null
    ));

    const hook = createHook({ modalOnlyMode: true });
    await hook.result.actions.openAiSummaryModal(defaultPageData('89', {
      space: { name: 'Engineering', icon: { path: '/images/space.png' } },
      history: { createdBy: {} },
      version: {
        by: {
          displayName: 'Fallback Contributor',
          profilePicture: { path: '/images/fallback-user.png' },
        },
        when: '2026-03-10',
      },
    }));
    await hook.flush();
    await hook.flush();

    expect(hook.result.state.aiContributorName).toBe('Fallback Contributor');
    expect(hook.result.state.aiContributorIconSrc).toContain('/images/fallback-user.png');
    hook.unmount();
  });

  it('keeps modal-only title stable while metadata is enriched', async () => {
    dbMocks.getStoredSummary.mockImplementation(async (id) => (
      id === '901'
        ? { summaryHtml: '<p>cached</p>', userPrompt: 'prompt' }
        : null
    ));
    confluenceApiMocks.fetchConfluenceMetadataById.mockResolvedValue({
      title: 'Actual page title',
      _links: { webui: '/pages/901' },
    });

    const hook = createHook({ modalOnlyMode: true });
    await hook.result.actions.openAiSummaryModal(defaultPageData('901', {
      title: 'Actual page title - Engineering Space - Confluence',
      space: { name: 'Engineering', icon: { path: '' } },
      history: { createdBy: { displayName: 'Alice' } },
    }));
    await hook.flush();
    await hook.flush();

    expect(hook.result.state.aiActiveItem?.title).toBe('Actual page title - Engineering Space - Confluence');
    hook.unmount();
  });

  it('captures pointer movement while resizing the outer modal', async () => {
    const hook = createHook();
    const resizeHandle = document.createElement('div');
    resizeHandle.setPointerCapture = vi.fn();
    resizeHandle.releasePointerCapture = vi.fn();
    resizeHandle.hasPointerCapture = vi.fn(() => true);
    Object.defineProperty(hook.result.refs.aiModalRef, 'current', {
      configurable: true,
      value: { offsetWidth: 900, offsetHeight: 620 },
    });

    hook.result.actions.startAiModalResize({
      preventDefault: vi.fn(),
      clientX: 500,
      pointerId: 7,
      currentTarget: resizeHandle,
    }, 'right');

    expect(resizeHandle.setPointerCapture).toHaveBeenCalledWith(7);
    resizeHandle.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 560 }));
    await hook.flush();
    expect(hook.result.state.aiModalWidth).toBe(window.innerWidth - 24);

    resizeHandle.dispatchEvent(new Event('pointerup'));
    expect(resizeHandle.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(document.body.style.cursor).toBe('');
    hook.unmount();
  });
});
