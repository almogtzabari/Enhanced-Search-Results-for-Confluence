import { describe, expect, it, vi } from 'vitest';
import { mountHook } from '../../../test/hookTestUtils.js';
import { useAiSummaryController } from '../controllers/useAiSummaryController.js';

vi.mock('../../../services/storage.js', () => ({
  getLocal: vi.fn(async () => ({})),
}));

vi.mock('../../../services/dbClient.js', () => ({
  getStoredConversation: vi.fn(async () => null),
  getStoredSummary: vi.fn(async (id) => (id === '10' ? { summaryHtml: '<p>x</p>' } : null)),
  storeConversation: vi.fn(async () => {}),
  storeSummary: vi.fn(async () => {}),
}));

vi.mock('../../../services/aiRuntime.js', () => ({
  getAiRuntimeSettings: vi.fn(async () => ({})),
  sendOpenAIRequest: vi.fn(async () => ({ output_text: '<p>x</p>' })),
  withTimeout: vi.fn(async (fn) => fn),
}));

vi.mock('../../../services/confluenceApi.js', () => ({
  enrichVisualMetadata: vi.fn(async (_base, data) => data),
  fetchConfluenceBodyById: vi.fn(async () => '<p>body</p>'),
  fetchConfluenceMetadataById: vi.fn(async () => ({})),
  fetchImageDataUrlViaHostBridge: vi.fn(async () => ''),
}));

describe('useAiSummaryController', () => {
  it('marks stored summaries as ready for loaded result ids', async () => {
    const hook = mountHook(useAiSummaryController, {
      baseUrl: 'https://example.atlassian.net/wiki',
      modalOnlyMode: false,
      modalContentId: '',
      modalContentTitle: '',
      enableSummaries: true,
      allResults: [{ id: '10', ancestors: [] }],
      openNoticeDialog: vi.fn(),
      openConfirmDialog: vi.fn(async () => true),
    });

    await hook.flush();
    await hook.flush();

    expect(hook.result.state.aiSummaryStatusById['10']).toBe('ready');
    hook.unmount();
  });
});
