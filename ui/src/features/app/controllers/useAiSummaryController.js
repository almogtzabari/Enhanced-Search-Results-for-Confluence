import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getLocal } from '../../../services/storage.js';
import {
  getAllStoredSummaries,
  getStoredConversation,
  getStoredSummary,
  storeConversation,
  storeSummary,
} from '../../../services/dbClient.js';
import {
  getAiRuntimeSettings,
  sendOpenAIRequest,
  withTimeout,
} from '../../../services/aiRuntime.js';
import {
  enrichVisualMetadata,
  fetchConfluenceBodyById,
  fetchConfluenceMetadataById,
  fetchImageDataUrlViaHostBridge,
} from '../../../services/confluenceApi.js';
import {
  DEFAULT_AI_CHAT_FONT_SIZE_PX,
  DEFAULT_AI_MODAL_HEIGHT_FALLBACK_PX,
  DEFAULT_AI_MODAL_WIDTH_FALLBACK_PX,
  DEFAULT_AI_QUESTION_HEIGHT,
  DEFAULT_AI_SUMMARY_FONT_SIZE_PX,
  DEFAULT_AI_SUMMARY_PANE_RATIO,
  MAX_AI_CHAT_FONT_SIZE_PX,
  MAX_AI_QUESTION_HEIGHT,
  MAX_AI_SUMMARY_FONT_SIZE_PX,
  MAX_AI_SUMMARY_PANE_RATIO,
  MIN_AI_CHAT_FONT_SIZE_PX,
  MIN_AI_MODAL_HEIGHT,
  MIN_AI_MODAL_WIDTH,
  MIN_AI_QUESTION_HEIGHT,
  MIN_AI_SUMMARY_FONT_SIZE_PX,
  MIN_AI_SUMMARY_PANE_RATIO,
  OPENAI_REQUEST_TIMEOUT_MS,
  fallbackSpaceIcon,
  fallbackUserIcon,
  qaSystemPrompt,
  summarySystemPrompt,
} from '../constants.js';
import { sanitizeHtmlFragment } from '../utils/htmlUtils.js';
import { detectDirectionFromHtml, formatDate } from '../utils/textUtils.js';
import { buildConfluenceUrl, resolveConfluenceIconUrl, resolveOrigin } from '../utils/urlUtils.js';
import {
  clampNumber,
  getDefaultAiModalHeight,
  getDefaultAiModalWidth,
  loadStoredAiFontSize,
  loadStoredAiQuestionHeight,
} from '../utils/uiStorage.js';

function collectSummaryCandidateIds(items) {
  const ids = new Set();
  items.forEach((item) => {
    if (!item?.id) return;
    ids.add(item.id);
    const ancestors = Array.isArray(item.ancestors) ? item.ancestors : [];
    ancestors.forEach((ancestor) => {
      if (ancestor?.id) ids.add(ancestor.id);
    });
  });
  return [...ids];
}

const MODAL_ONLY_METADATA_PREFETCH_TIMEOUT_MS = 9000;
const AI_LOADING_TITLE_BUILDING = 'Building your summary';
const AI_LOADING_TITLE_CACHED = 'Loading your summary';

function contributorHasSignal(candidate) {
  if (!candidate || typeof candidate !== 'object') return false;
  return Boolean(
    candidate?.displayName
    || candidate?.publicName
    || candidate?.fullName
    || candidate?.username
    || candidate?.userKey
    || candidate?.accountId
    || candidate?.profilePicture?.path,
  );
}

function resolveContributorCandidate(pageData) {
  const candidates = [
    pageData?.history?.createdBy,
    pageData?.history?.lastUpdated?.by,
    pageData?.version?.by,
  ];
  const withSignal = candidates.find(contributorHasSignal);
  if (withSignal) return withSignal;
  const firstObject = candidates.find((candidate) => candidate && typeof candidate === 'object');
  return firstObject || {};
}

function resolveContributorDisplayName(pageData) {
  const contributor = resolveContributorCandidate(pageData);
  return contributor?.displayName
    || contributor?.publicName
    || contributor?.fullName
    || contributor?.username
    || contributor?.userKey
    || contributor?.accountId
    || 'Unknown';
}

function hasContributorIdentity(pageData) {
  const contributor = resolveContributorCandidate(pageData);
  return Boolean(
    contributor?.displayName
    || contributor?.publicName
    || contributor?.fullName
    || contributor?.username
    || contributor?.userKey
    || contributor?.accountId,
  );
}

// Owns AI modal behavior for both views mode and content-modal iframe mode.
export function useAiSummaryController({
  baseUrl,
  modalOnlyMode,
  modalContentId,
  modalContentTitle,
  modalContentType = '',
  modalContentWebUi = '',
  modalSpaceName = '',
  modalSpaceKey = '',
  modalSpaceIconPath = '',
  modalContributorName = '',
  modalContributorUsername = '',
  modalContributorAvatarPath = '',
  modalModifiedWhen = '',
  enableSummaries,
  allResults,
  openNoticeDialog,
  openConfirmDialog,
}) {
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiModalLoading, setAiModalLoading] = useState(false);
  const [aiModalLoadingTitle, setAiModalLoadingTitle] = useState(AI_LOADING_TITLE_BUILDING);
  const [aiItemLoadingId, setAiItemLoadingId] = useState(null);
  const [aiActiveItem, setAiActiveItem] = useState(null);
  const [aiContextBaseUrl, setAiContextBaseUrl] = useState('');
  const [aiSummaryHtml, setAiSummaryHtml] = useState('');
  const [aiUserPrompt, setAiUserPrompt] = useState('');
  const [aiConversation, setAiConversation] = useState([]);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswerLoading, setAiAnswerLoading] = useState(false);
  const [aiSummaryRefreshing, setAiSummaryRefreshing] = useState(false);
  const [aiSummaryStatusById, setAiSummaryStatusById] = useState({});
  const [aiSummaryCheckedById, setAiSummaryCheckedById] = useState({});
  const [aiSummaryPaneRatio, setAiSummaryPaneRatio] = useState(() => {
    const saved = Number.parseFloat(sessionStorage.getItem('aiSummaryPaneRatio') || '');
    if (!Number.isFinite(saved)) return DEFAULT_AI_SUMMARY_PANE_RATIO;
    return Math.max(MIN_AI_SUMMARY_PANE_RATIO, Math.min(MAX_AI_SUMMARY_PANE_RATIO, saved));
  });
  const [isAiSummaryCollapsed, setIsAiSummaryCollapsed] = useState(false);
  const [isAiChatCollapsed, setIsAiChatCollapsed] = useState(false);
  const [aiModalWidth, setAiModalWidth] = useState(() => {
    const saved = Number.parseFloat(sessionStorage.getItem('aiModalWidth') || '');
    if (!Number.isFinite(saved)) return DEFAULT_AI_MODAL_WIDTH_FALLBACK_PX;
    const maxWidth = Math.max(MIN_AI_MODAL_WIDTH, window.innerWidth - 24);
    return clampNumber(saved, MIN_AI_MODAL_WIDTH, maxWidth);
  });
  const [aiModalHeight, setAiModalHeight] = useState(() => {
    const saved = Number.parseFloat(sessionStorage.getItem('aiModalHeight') || '');
    if (!Number.isFinite(saved)) return DEFAULT_AI_MODAL_HEIGHT_FALLBACK_PX;
    const maxHeight = Math.max(MIN_AI_MODAL_HEIGHT, window.innerHeight - 32);
    return clampNumber(saved, MIN_AI_MODAL_HEIGHT, maxHeight);
  });
  const [aiSummaryFontSize, setAiSummaryFontSize] = useState(() => loadStoredAiFontSize(
    'aiSummaryFontSizePx',
    DEFAULT_AI_SUMMARY_FONT_SIZE_PX,
    MIN_AI_SUMMARY_FONT_SIZE_PX,
    MAX_AI_SUMMARY_FONT_SIZE_PX,
  ));
  const [aiChatFontSize, setAiChatFontSize] = useState(() => loadStoredAiFontSize(
    'aiChatFontSizePx',
    DEFAULT_AI_CHAT_FONT_SIZE_PX,
    MIN_AI_CHAT_FONT_SIZE_PX,
    MAX_AI_CHAT_FONT_SIZE_PX,
  ));
  const [aiQuestionInputHeight, setAiQuestionInputHeight] = useState(() => loadStoredAiQuestionHeight());
  const [aiSpaceIconSrc, setAiSpaceIconSrc] = useState(fallbackSpaceIcon);
  const [aiContributorIconSrc, setAiContributorIconSrc] = useState(fallbackUserIcon);

  const aiThreadRef = useRef(null);
  const aiModalRef = useRef(null);
  const aiLayoutRef = useRef(null);
  const aiQuestionInputRef = useRef(null);
  const hasStoredAiModalWidthRef = useRef(Number.isFinite(
    Number.parseFloat(sessionStorage.getItem('aiModalWidth') || ''),
  ));
  const hasStoredAiModalHeightRef = useRef(Number.isFinite(
    Number.parseFloat(sessionStorage.getItem('aiModalHeight') || ''),
  ));
  const modalOnlyInitializedRef = useRef(false);
  const shouldAutoFocusAiQuestionRef = useRef(false);
  const cachedSummaryByIdRef = useRef({});
  const summaryRequestSeqRef = useRef(0);
  const activeModalRequestRef = useRef({ requestId: 0, contentId: '' });
  const clearConversationAudioRef = useRef(null);

  const playClearConversationSound = () => {
    if (typeof window === 'undefined' || typeof window.Audio !== 'function') return;
    try {
      if (!clearConversationAudioRef.current) {
        const player = new window.Audio('../../assets/sounds/swoosh.mp3');
        player.preload = 'auto';
        clearConversationAudioRef.current = player;
      }
      const player = clearConversationAudioRef.current;
      player.currentTime = 0;
      const playback = player.play?.();
      if (playback && typeof playback.catch === 'function') {
        playback.catch(() => {});
      }
    } catch {
      // Ignore audio playback errors so clearing conversation still succeeds.
    }
  };

  const createBaseConversation = (userPromptText, summaryHtml) => ([
    { role: 'system', content: qaSystemPrompt },
    { role: 'user', content: userPromptText },
    { role: 'assistant', content: summaryHtml },
  ]);

  const buildUserPrompt = async (pageData, forceBodyFetch = false, contextBaseUrl = baseUrl) => {
    const resolvedBaseUrl = String(contextBaseUrl || baseUrl || window.location.origin).trim();
    const bodyHtml = await fetchConfluenceBodyById(resolvedBaseUrl, pageData.id, {
      force: forceBodyFetch,
      sanitizeHtmlFragment,
    });
    const localData = await getLocal(['customUserPrompt']);
    const customPrompt = (localData.customUserPrompt || '').trim();
    const pageUrl = buildConfluenceUrl(resolvedBaseUrl, pageData._links?.webui);
    const parentTitles = (Array.isArray(pageData.ancestors) ? pageData.ancestors : [])
      .map((ancestor) => ancestor?.title)
      .filter(Boolean);
    const parentPath = parentTitles.length ? parentTitles.join(' > ') : 'N/A';
    const directParent = parentTitles.length ? parentTitles[parentTitles.length - 1] : 'N/A';
    const details = `
--- Content Details ---
Title: ${pageData.title || 'Untitled'}
Contributor: ${resolveContributorDisplayName(pageData)}
Created: ${pageData.history?.createdDate || 'N/A'}
Modified: ${formatDate(pageData.version?.when)}
Type: ${pageData.type || 'page'}
Space: ${pageData.space?.name || 'N/A'}
Direct Parent: ${directParent}
Parent Path: ${parentPath}
URL: ${pageUrl}
Content (HTML): ${bodyHtml}
    `.trim();
    return customPrompt ? `${customPrompt}\n\n${details}` : details;
  };

  const normalizePageData = (rawPageData) => ({
    ...(rawPageData || {}),
    ancestors: Array.isArray(rawPageData?.ancestors) ? rawPageData.ancestors : [],
  });

  const resolvePageDataWithMetadata = async (seedPageData, effectiveBaseUrl, contentId) => {
    let resolvedPageData = normalizePageData(seedPageData);
    try {
      const metadata = await fetchConfluenceMetadataById(effectiveBaseUrl, contentId);
      resolvedPageData = {
        ...resolvedPageData,
        ...metadata,
        space: { ...(resolvedPageData.space || {}), ...(metadata.space || {}) },
        history: {
          ...(resolvedPageData.history || {}),
          ...(metadata.history || {}),
          createdBy: {
            ...(resolvedPageData.history?.createdBy || {}),
            ...(metadata.history?.createdBy || {}),
          },
        },
        _links: { ...(resolvedPageData._links || {}), ...(metadata._links || {}) },
      };
      const metadataContributor = metadata?.history?.createdBy
        || metadata?.history?.lastUpdated?.by
        || metadata?.version?.by
        || null;
      if (metadataContributor && typeof metadataContributor === 'object') {
        resolvedPageData.history = {
          ...(resolvedPageData.history || {}),
          createdBy: {
            ...metadataContributor,
            ...(resolvedPageData.history?.createdBy || {}),
          },
        };
      }
    } catch (metaErr) {
      console.warn('[V2 Preact] Metadata fetch failed, using existing page data:', metaErr);
    }

    return enrichVisualMetadata(effectiveBaseUrl, resolvedPageData);
  };

  const loadConversationForModal = async ({
    contentId,
    effectiveBaseUrl,
    userPromptText,
    summaryHtml,
    allowStoredConversation,
  }) => {
    if (allowStoredConversation) {
      try {
        const storedConversation = await getStoredConversation(contentId, effectiveBaseUrl);
        if (Array.isArray(storedConversation?.messages)) {
          return storedConversation.messages.map((msg) => (
            msg.role === 'assistant'
              ? { ...msg, content: sanitizeHtmlFragment(msg.content || '') }
              : msg
          ));
        }
      } catch (conversationErr) {
        console.warn('[V2 Preact] Conversation fetch failed, rebuilding base conversation:', conversationErr);
      }
    }

    const conversation = createBaseConversation(userPromptText, summaryHtml);
    try {
      await storeConversation(contentId, effectiveBaseUrl, conversation);
    } catch (persistErr) {
      console.warn('[V2 Preact] Conversation store failed:', persistErr);
    }
    return conversation;
  };

  const isActiveModalRequest = (requestId, contentId) => (
    activeModalRequestRef.current.requestId === requestId
    && activeModalRequestRef.current.contentId === contentId
  );

  const normalizeBaseUrlForComparison = (value) => String(value || '')
    .trim()
    .replace(/\/+$/, '')
    .toLowerCase();

  const hasPrefetchedModalMetadata = (pageData) => {
    if (!modalOnlyMode) return false;
    const hasSpaceIdentity = Boolean(pageData?.space?.name || pageData?.space?.key);
    const hasSpaceIcon = Boolean(pageData?.space?.icon?.path);
    const hasContributorAvatar = Boolean(resolveContributorCandidate(pageData)?.profilePicture?.path);
    return hasSpaceIdentity && hasContributorIdentity(pageData) && hasSpaceIcon && hasContributorAvatar;
  };

  const resolveModalReadyPageData = async (seedPageData, effectiveBaseUrl, contentId) => {
    const normalizedSeed = normalizePageData(seedPageData);
    if (!modalOnlyMode) return normalizedSeed;
    if (hasPrefetchedModalMetadata(normalizedSeed)) return normalizedSeed;
    try {
      return await withTimeout(
        resolvePageDataWithMetadata(normalizedSeed, effectiveBaseUrl, contentId),
        MODAL_ONLY_METADATA_PREFETCH_TIMEOUT_MS,
        'Metadata prefetch timed out.',
      );
    } catch (metaErr) {
      console.warn('[V2 Preact] Modal metadata prefetch failed, opening with fallback page data:', metaErr);
      return normalizedSeed;
    }
  };

  const openAiSummaryModal = async (
    pageData,
    { forceResummarize = false, contextBaseUrl = baseUrl } = {},
  ) => {
    if (!pageData?.id) return;
    if (!enableSummaries) {
      openNoticeDialog({
        title: 'AI Summaries Disabled',
        message: 'Enable AI summaries in the extension options.',
        tone: 'info',
      });
      return;
    }

    const contentId = pageData.id;
    const effectiveBaseUrl = String(contextBaseUrl || baseUrl || window.location.origin).trim();
    const normalizedPageData = normalizePageData(pageData);
    const initialDisplayTitle = String(normalizedPageData?.title || '').trim();
    const fallbackDisplayTitle = `Page ${contentId}`;
    const shouldLockInitialModalTitle = (
      modalOnlyMode
      && initialDisplayTitle
      && initialDisplayTitle !== fallbackDisplayTitle
    );
    const requestId = summaryRequestSeqRef.current + 1;
    summaryRequestSeqRef.current = requestId;
    activeModalRequestRef.current = { requestId, contentId };
    const useBlockingLoader = !(forceResummarize && aiModalOpen);

    // The content-page iframe starts fully transparent and clipped until the
    // modal reports its bounds. Render its loading shell before any extension
    // storage or permission preflight so the host can reveal it immediately.
    if (modalOnlyMode && isActiveModalRequest(requestId, contentId)) {
      setAiContextBaseUrl(effectiveBaseUrl);
      if (useBlockingLoader) {
        setAiModalLoadingTitle(AI_LOADING_TITLE_BUILDING);
        setAiModalLoading(true);
      }
      setAiActiveItem(normalizedPageData);
      if (!aiModalOpen) setAiModalOpen(true);
    }

    const preflightStoredSummary = !forceResummarize
      ? (cachedSummaryByIdRef.current[contentId] || await getStoredSummary(contentId, effectiveBaseUrl))
      : null;
    if (!isActiveModalRequest(requestId, contentId)) return;

    const loadingTitle = preflightStoredSummary?.summaryHtml
      ? AI_LOADING_TITLE_CACHED
      : AI_LOADING_TITLE_BUILDING;
    if (preflightStoredSummary?.summaryHtml) {
      cachedSummaryByIdRef.current[contentId] = preflightStoredSummary;
    }

    if (!preflightStoredSummary?.summaryHtml) {
      try {
        await getAiRuntimeSettings({ requireApiKey: true, requestEndpointPermission: false });
      } catch (err) {
        if (!isActiveModalRequest(requestId, contentId)) return;
        const message = err?.message || 'Unknown error';
        const isApiKeyIssue = /api key/i.test(message);
        openNoticeDialog({
          title: isApiKeyIssue ? 'OpenAI API Key Missing' : 'AI Setup Required',
          message: isApiKeyIssue
            ? 'Please set your OpenAI API key in the extension Options page first.'
            : message,
          tone: 'error',
        });
        if (modalOnlyMode) setAiModalLoading(false);
        return;
      }
    }

    if (modalOnlyMode && isActiveModalRequest(requestId, contentId)) {
      setAiContextBaseUrl(effectiveBaseUrl);
      if (useBlockingLoader) {
        setAiModalLoadingTitle(loadingTitle);
        setAiModalLoading(true);
      }
      setAiActiveItem(normalizedPageData);
      if (!aiModalOpen) setAiModalOpen(true);
    }

    const modalReadyPageData = await resolveModalReadyPageData(
      normalizedPageData,
      effectiveBaseUrl,
      contentId,
    );
    if (!isActiveModalRequest(requestId, contentId)) return;
    const modalDisplayPageData = shouldLockInitialModalTitle
      ? { ...modalReadyPageData, title: initialDisplayTitle }
      : modalReadyPageData;

    setAiItemLoadingId(contentId);
    setAiSummaryStatusById((prev) => ({ ...prev, [contentId]: 'loading' }));
    if (isActiveModalRequest(requestId, contentId)) {
      setAiContextBaseUrl(effectiveBaseUrl);
      const useBlockingLoader = !(forceResummarize && aiModalOpen);
      if (useBlockingLoader) {
        setAiModalLoadingTitle(loadingTitle);
        setAiModalLoading(true);
      }
      setAiActiveItem(modalDisplayPageData);
      if (!aiModalOpen) setAiModalOpen(true);
    }

    try {
      let summaryHtml = '';
      let userPromptText = '';
      let conversation = null;

      const storedSummary = !forceResummarize
        ? preflightStoredSummary
        : null;

      if (storedSummary?.summaryHtml) {
        summaryHtml = sanitizeHtmlFragment(storedSummary.summaryHtml);
        userPromptText = storedSummary.userPrompt || 'Answer follow-up questions using the stored summary context.';

        if (isActiveModalRequest(requestId, contentId)) {
          setAiSummaryHtml(summaryHtml);
          setAiUserPrompt(userPromptText);
          setAiQuestion('');
        }
        setAiSummaryStatusById((prev) => ({ ...prev, [contentId]: 'ready' }));
        setAiSummaryCheckedById((prev) => ({ ...prev, [contentId]: true }));
        if (isActiveModalRequest(requestId, contentId)) {
          setAiModalLoading(false);
        }

        conversation = await loadConversationForModal({
          contentId,
          effectiveBaseUrl,
          userPromptText,
          summaryHtml,
          allowStoredConversation: true,
        });
        if (isActiveModalRequest(requestId, contentId)) {
          setAiConversation(conversation);
        }

        if (!modalOnlyMode) {
          void (async () => {
            try {
              const resolvedPageData = await resolvePageDataWithMetadata(
                normalizedPageData,
                effectiveBaseUrl,
                contentId,
              );
              if (!isActiveModalRequest(requestId, contentId)) return;
              setAiActiveItem((prev) => (
                prev?.id === contentId
                  ? resolvedPageData
                  : prev
              ));
            } catch (metaErr) {
              console.warn('[V2 Preact] Visual metadata enrichment failed:', metaErr);
            }
          })();
        }
        return;
      } else {
        const resolvedPageData = modalOnlyMode
          ? modalDisplayPageData
          : await resolvePageDataWithMetadata(
            normalizedPageData,
            effectiveBaseUrl,
            contentId,
          );
        if (isActiveModalRequest(requestId, contentId)) {
          setAiActiveItem(resolvedPageData);
        }

        const {
          apiKey, apiUrl, model, reasoningEffort,
        } = await getAiRuntimeSettings({ requireApiKey: true, requestEndpointPermission: false });
        userPromptText = await buildUserPrompt(resolvedPageData, forceResummarize, effectiveBaseUrl);
        const requestAbortController = new AbortController();
        const result = await withTimeout(
          sendOpenAIRequest({
            apiKey,
            apiUrl,
            model,
            reasoningEffort,
            messages: [
              { role: 'system', content: summarySystemPrompt },
              { role: 'user', content: userPromptText },
            ],
            signal: requestAbortController.signal,
          }),
          OPENAI_REQUEST_TIMEOUT_MS,
          'Summary request timed out. Please try again.',
          () => requestAbortController.abort(),
        );
        summaryHtml = sanitizeHtmlFragment(result.output_text || '[No response]');
        await storeSummary({
          contentId,
          baseUrl: effectiveBaseUrl,
          title: resolvedPageData.title || normalizedPageData.title,
          summaryHtml,
          userPrompt: userPromptText,
          timestamp: Date.now(),
        });
        cachedSummaryByIdRef.current[contentId] = {
          contentId,
          baseUrl: effectiveBaseUrl,
          title: resolvedPageData.title || normalizedPageData.title,
          summaryHtml,
          userPrompt: userPromptText,
        };
      }

      conversation = await loadConversationForModal({
        contentId,
        effectiveBaseUrl,
        userPromptText,
        summaryHtml,
        allowStoredConversation: !forceResummarize,
      });

      if (isActiveModalRequest(requestId, contentId)) {
        setAiSummaryHtml(summaryHtml);
        setAiUserPrompt(userPromptText);
        setAiConversation(conversation);
        setAiQuestion('');
      }
      setAiSummaryStatusById((prev) => ({ ...prev, [contentId]: 'ready' }));
      setAiSummaryCheckedById((prev) => ({ ...prev, [contentId]: true }));
    } catch (err) {
      console.error('[V2 Preact] AI summary failed:', err);
      if (isActiveModalRequest(requestId, contentId)) {
        openNoticeDialog({
          title: 'Failed to Summarize Page',
          message: err.message || 'Unknown error',
          tone: 'error',
        });
      }
      setAiSummaryStatusById((prev) => ({
        ...prev,
        [contentId]: prev[contentId] === 'ready' ? 'ready' : 'idle',
      }));
      setAiSummaryCheckedById((prev) => ({ ...prev, [contentId]: true }));
    } finally {
      setAiItemLoadingId((prev) => (prev === contentId ? null : prev));
      if (isActiveModalRequest(requestId, contentId)) {
        setAiModalLoading(false);
        setAiSummaryRefreshing(false);
      }
    }
  };

  const submitAiQuestion = async () => {
    if (!aiActiveItem?.id || aiAnswerLoading) return;
    const question = aiQuestion.trim();
    if (!question) return;
    const conversationBaseUrl = String(aiContextBaseUrl || baseUrl || window.location.origin).trim();

    const withUser = [...aiConversation, { role: 'user', content: question }];
    setAiConversation(withUser);
    setAiQuestion('');
    setAiAnswerLoading(true);

    try {
      const {
        apiKey, apiUrl, model, reasoningEffort,
      } = await getAiRuntimeSettings({ requireApiKey: true, requestEndpointPermission: false });
      const requestAbortController = new AbortController();
      const result = await withTimeout(
        sendOpenAIRequest({
          apiKey,
          apiUrl,
          model,
          reasoningEffort,
          messages: withUser,
          signal: requestAbortController.signal,
        }),
        OPENAI_REQUEST_TIMEOUT_MS,
        'Q&A request timed out. Please try again.',
        () => requestAbortController.abort(),
      );
      const answer = sanitizeHtmlFragment(result.output_text || '[No response]');
      const nextConversation = [...withUser, { role: 'assistant', content: answer }];
      setAiConversation(nextConversation);
      await storeConversation(aiActiveItem.id, conversationBaseUrl, nextConversation);
    } catch (err) {
      console.error('[V2 Preact] AI Q&A failed:', err);
      openNoticeDialog({
        title: 'Failed to Get Answer',
        message: err.message || 'Unknown error',
        tone: 'error',
      });
    } finally {
      setAiAnswerLoading(false);
    }
  };

  const clearAiConversation = async () => {
    if (!aiActiveItem?.id) return;
    const conversationBaseUrl = String(aiContextBaseUrl || baseUrl || window.location.origin).trim();
    const confirmed = await openConfirmDialog({
      title: 'Clear conversation?',
      message: 'This will remove all follow-up messages but keep the summary.',
      confirmLabel: 'Clear',
      danger: true,
    });
    if (!confirmed) return;
    playClearConversationSound();
    const resetConversation = createBaseConversation(aiUserPrompt, aiSummaryHtml);
    setAiConversation(resetConversation);
    try {
      await storeConversation(aiActiveItem.id, conversationBaseUrl, resetConversation);
    } catch (err) {
      console.error('[V2 Preact] Failed to clear conversation:', err);
      openNoticeDialog({
        title: 'Failed to Clear Conversation',
        message: err.message || 'Unknown error',
        tone: 'error',
      });
    }
  };

  const resummarizeActiveItem = async () => {
    if (!aiActiveItem) return;
    setAiModalLoading(false);
    setAiSummaryRefreshing(true);
    try {
      await openAiSummaryModal(aiActiveItem, {
        forceResummarize: true,
        contextBaseUrl: aiContextBaseUrl || baseUrl,
      });
    } finally {
      setAiSummaryRefreshing(false);
    }
  };

  const closeAiModal = () => {
    const modalBaseUrl = String(aiContextBaseUrl || baseUrl || window.location.origin).trim();
    setAiModalOpen(false);
    setAiModalLoading(false);
    setAiModalLoadingTitle(AI_LOADING_TITLE_BUILDING);
    setAiSummaryRefreshing(false);
    setAiContextBaseUrl('');
    activeModalRequestRef.current = { requestId: 0, contentId: '' };
    if (modalOnlyMode && window.parent && window.parent !== window) {
      const parentOrigin = resolveOrigin(modalBaseUrl);
      if (parentOrigin) {
        window.parent.postMessage(
          { type: 'enhanced-ai-modal-close' },
          parentOrigin,
        );
      }
    }
  };

  useEffect(() => {
    if (!modalOnlyMode || !modalContentId || modalOnlyInitializedRef.current) return;
    modalOnlyInitializedRef.current = true;

    (async () => {
      try {
        const pageData = {
          id: modalContentId,
          title: modalContentTitle || `Page ${modalContentId}`,
          type: modalContentType || 'page',
          _links: {
            webui: modalContentWebUi || '',
          },
          space: {
            key: modalSpaceKey || '',
            name: modalSpaceName || '',
            icon: {
              path: modalSpaceIconPath || '',
            },
          },
          history: {
            createdBy: {
              displayName: modalContributorName || '',
              username: modalContributorUsername || '',
              profilePicture: {
                path: modalContributorAvatarPath || '',
              },
            },
          },
          version: {
            when: modalModifiedWhen || '',
          },
          ancestors: [],
        };
        await openAiSummaryModal(pageData);
      } catch (err) {
        console.error('[V2 Preact] Failed to open content-page modal-only summary:', err);
        openNoticeDialog({
          title: 'Failed to Open AI Summary',
          message: err.message || 'Unknown error',
          tone: 'error',
        });
        closeAiModal();
      }
    })();
  }, [
    modalOnlyMode,
    modalContentId,
    modalContentTitle,
    modalContentType,
    modalContentWebUi,
    modalSpaceName,
    modalSpaceKey,
    modalSpaceIconPath,
    modalContributorName,
    modalContributorUsername,
    modalContributorAvatarPath,
    modalModifiedWhen,
    baseUrl,
  ]);

  useEffect(() => {
    if (!aiModalOpen) return undefined;
    const onEscape = (e) => {
      if (e.key === 'Escape') closeAiModal();
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [aiModalOpen, closeAiModal]);

  useEffect(() => {
    if (!aiModalOpen) return;
    const thread = aiThreadRef.current;
    if (!thread) return;
    thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
  }, [aiConversation, aiAnswerLoading, aiModalOpen]);

  useEffect(() => {
    if (!aiModalOpen) return;
    shouldAutoFocusAiQuestionRef.current = true;
  }, [aiModalOpen]);

  useEffect(() => {
    if (!aiModalOpen || aiModalLoading || isAiChatCollapsed) return;
    if (!shouldAutoFocusAiQuestionRef.current) return;

    const focusTimer = setTimeout(() => {
      const input = aiQuestionInputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      shouldAutoFocusAiQuestionRef.current = false;
    }, 0);

    return () => clearTimeout(focusTimer);
  }, [aiModalOpen, aiModalLoading, isAiChatCollapsed]);

  useEffect(() => {
    setAiSummaryStatusById({});
    setAiSummaryCheckedById({});
    cachedSummaryByIdRef.current = {};
  }, [baseUrl]);

  useEffect(() => {
    const ids = collectSummaryCandidateIds(allResults);
    const unchecked = ids.filter((id) => !aiSummaryCheckedById[id] && aiItemLoadingId !== id);
    if (unchecked.length === 0) return;

    let alive = true;
    (async () => {
      let checks = [];
      try {
        const allSummaries = await getAllStoredSummaries();
        const summaries = Array.isArray(allSummaries) ? allSummaries : [];
        const targetBase = normalizeBaseUrlForComparison(baseUrl);
        const summaryById = new Map();
        summaries.forEach((entry) => {
          const id = String(entry?.contentId || '').trim();
          if (!id) return;
          if (!entry?.summaryHtml) return;
          if (normalizeBaseUrlForComparison(entry?.baseUrl) !== targetBase) return;
          if (!summaryById.has(id)) summaryById.set(id, entry);
        });
        checks = unchecked.map((id) => {
          const cached = summaryById.get(String(id));
          if (cached?.summaryHtml) cachedSummaryByIdRef.current[id] = cached;
          return { id, hasSummary: !!cached?.summaryHtml };
        });
      } catch {
        checks = await Promise.all(
          unchecked.map(async (id) => {
            try {
              const stored = await getStoredSummary(id, baseUrl);
              if (stored?.summaryHtml) cachedSummaryByIdRef.current[id] = stored;
              return { id, hasSummary: !!stored?.summaryHtml };
            } catch {
              return { id, hasSummary: false };
            }
          }),
        );
      }
      if (!alive) return;

      setAiSummaryStatusById((prev) => {
        const next = { ...prev };
        checks.forEach(({ id, hasSummary }) => {
          if (next[id] === 'loading') return;
          next[id] = hasSummary ? 'ready' : (next[id] || 'idle');
        });
        return next;
      });

      setAiSummaryCheckedById((prev) => {
        const next = { ...prev };
        checks.forEach(({ id }) => {
          next[id] = true;
        });
        return next;
      });
    })();

    return () => {
      alive = false;
    };
  }, [allResults, aiSummaryCheckedById, aiItemLoadingId, baseUrl]);

  const aiBaseUrl = useMemo(
    () => String(aiContextBaseUrl || baseUrl || window.location.origin).trim(),
    [aiContextBaseUrl, baseUrl],
  );
  const aiSpaceIconUrl = useMemo(() => (
    resolveConfluenceIconUrl(aiBaseUrl, aiActiveItem?.space?.icon?.path || '', fallbackSpaceIcon)
  ), [aiBaseUrl, aiActiveItem]);
  const aiContributorMeta = useMemo(() => resolveContributorCandidate(aiActiveItem), [aiActiveItem]);
  const aiContributorIconUrl = useMemo(() => (
    resolveConfluenceIconUrl(aiBaseUrl, aiContributorMeta?.profilePicture?.path || '', fallbackUserIcon)
  ), [aiBaseUrl, aiContributorMeta]);
  const aiContributorName = useMemo(
    () => resolveContributorDisplayName(aiActiveItem),
    [aiActiveItem],
  );
  const aiSummaryDirection = useMemo(() => detectDirectionFromHtml(aiSummaryHtml), [aiSummaryHtml]);

  useEffect(() => {
    let alive = true;

    const directSpaceUrl = aiSpaceIconUrl || fallbackSpaceIcon;
    const directContributorUrl = aiContributorIconUrl || fallbackUserIcon;
    setAiSpaceIconSrc(directSpaceUrl);
    setAiContributorIconSrc(directContributorUrl);

    if (!modalOnlyMode) return () => { alive = false; };

    (async () => {
      try {
        if (directSpaceUrl && !directSpaceUrl.startsWith('data:')) {
          const bridgedSpace = await fetchImageDataUrlViaHostBridge(directSpaceUrl, 12000);
          if (alive && bridgedSpace) setAiSpaceIconSrc(bridgedSpace);
        }
      } catch {
        // Keep direct URL or fallback
      }
    })();

    (async () => {
      try {
        if (directContributorUrl && !directContributorUrl.startsWith('data:')) {
          const bridgedContributor = await fetchImageDataUrlViaHostBridge(directContributorUrl, 12000);
          if (alive && bridgedContributor) setAiContributorIconSrc(bridgedContributor);
        }
      } catch {
        // Keep direct URL or fallback
      }
    })();

    return () => { alive = false; };
  }, [modalOnlyMode, aiSpaceIconUrl, aiContributorIconUrl]);

  const startAiModalResize = (event, direction) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = aiModalRef.current?.offsetWidth || aiModalWidth;
    const resizeHandle = event.currentTarget;
    const pointerId = event.pointerId;
    if (typeof resizeHandle?.setPointerCapture === 'function') {
      resizeHandle.setPointerCapture(pointerId);
    }

    const onMove = (moveEvent) => {
      const delta = direction === 'right'
        ? moveEvent.clientX - startX
        : startX - moveEvent.clientX;
      const maxWidth = Math.max(MIN_AI_MODAL_WIDTH, window.innerWidth - 24);
      const nextWidth = Math.max(MIN_AI_MODAL_WIDTH, Math.min(maxWidth, startWidth + (2 * delta)));
      setAiModalWidth(nextWidth);
      sessionStorage.setItem('aiModalWidth', String(nextWidth));
      hasStoredAiModalWidthRef.current = true;
    };

    const onStop = () => {
      resizeHandle?.removeEventListener('pointermove', onMove);
      resizeHandle?.removeEventListener('pointerup', onStop);
      resizeHandle?.removeEventListener('pointercancel', onStop);
      if (
        typeof resizeHandle?.releasePointerCapture === 'function'
        && (typeof resizeHandle.hasPointerCapture !== 'function' || resizeHandle.hasPointerCapture(pointerId))
      ) {
        resizeHandle.releasePointerCapture(pointerId);
      }
      document.body.style.cursor = '';
    };

    document.body.style.cursor = 'ew-resize';
    resizeHandle?.addEventListener('pointermove', onMove);
    resizeHandle?.addEventListener('pointerup', onStop);
    resizeHandle?.addEventListener('pointercancel', onStop);
  };

  const resetAiModalWidth = () => {
    setAiModalWidth(getDefaultAiModalWidth());
    sessionStorage.removeItem('aiModalWidth');
    hasStoredAiModalWidthRef.current = false;
  };

  const startAiModalHeightResize = (event, edge = 'bottom') => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = aiModalRef.current?.offsetHeight || aiModalHeight;
    const resizeHandle = event.currentTarget;
    const pointerId = event.pointerId;
    if (typeof resizeHandle?.setPointerCapture === 'function') {
      resizeHandle.setPointerCapture(pointerId);
    }

    const onMove = (moveEvent) => {
      const delta = moveEvent.clientY - startY;
      const maxHeight = Math.max(MIN_AI_MODAL_HEIGHT, window.innerHeight - 32);
      const adjustedDelta = edge === 'top' ? -delta : delta;
      const nextHeight = Math.max(MIN_AI_MODAL_HEIGHT, Math.min(maxHeight, startHeight + (2 * adjustedDelta)));
      setAiModalHeight(nextHeight);
      sessionStorage.setItem('aiModalHeight', String(nextHeight));
      hasStoredAiModalHeightRef.current = true;
    };

    const onStop = () => {
      resizeHandle?.removeEventListener('pointermove', onMove);
      resizeHandle?.removeEventListener('pointerup', onStop);
      resizeHandle?.removeEventListener('pointercancel', onStop);
      if (
        typeof resizeHandle?.releasePointerCapture === 'function'
        && (typeof resizeHandle.hasPointerCapture !== 'function' || resizeHandle.hasPointerCapture(pointerId))
      ) {
        resizeHandle.releasePointerCapture(pointerId);
      }
      document.body.style.cursor = '';
    };

    document.body.style.cursor = 'ns-resize';
    resizeHandle?.addEventListener('pointermove', onMove);
    resizeHandle?.addEventListener('pointerup', onStop);
    resizeHandle?.addEventListener('pointercancel', onStop);
  };

  const resetAiModalHeight = () => {
    setAiModalHeight(getDefaultAiModalHeight());
    sessionStorage.removeItem('aiModalHeight');
    hasStoredAiModalHeightRef.current = false;
  };

  const startAiQuestionInputResize = (event) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = aiQuestionInputRef.current?.offsetHeight || aiQuestionInputHeight;

    const onMove = (moveEvent) => {
      const delta = startY - moveEvent.clientY;
      const nextHeight = Math.max(
        MIN_AI_QUESTION_HEIGHT,
        Math.min(MAX_AI_QUESTION_HEIGHT, startHeight + delta),
      );
      setAiQuestionInputHeight(nextHeight);
      sessionStorage.setItem('aiQuestionInputHeight', String(nextHeight));
    };

    const onStop = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onStop);
      document.body.style.cursor = '';
    };

    document.body.style.cursor = 'ns-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onStop);
  };

  const resetAiQuestionInputHeight = () => {
    setAiQuestionInputHeight(DEFAULT_AI_QUESTION_HEIGHT);
    sessionStorage.removeItem('aiQuestionInputHeight');
  };

  const startAiPaneResize = (event) => {
    if (isAiSummaryCollapsed || isAiChatCollapsed) return;
    event.preventDefault();
    const layout = aiLayoutRef.current;
    if (!layout) return;
    const rect = layout.getBoundingClientRect();

    const onMove = (moveEvent) => {
      const ratio = (moveEvent.clientX - rect.left) / rect.width;
      const nextRatio = Math.max(MIN_AI_SUMMARY_PANE_RATIO, Math.min(MAX_AI_SUMMARY_PANE_RATIO, ratio));
      setAiSummaryPaneRatio(nextRatio);
      sessionStorage.setItem('aiSummaryPaneRatio', String(nextRatio));
    };

    const onStop = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onStop);
      document.body.style.cursor = '';
    };

    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onStop);
  };

  const resetAiSummaryPaneRatio = () => {
    setAiSummaryPaneRatio(DEFAULT_AI_SUMMARY_PANE_RATIO);
    sessionStorage.removeItem('aiSummaryPaneRatio');
  };

  const toggleSummaryPane = () => {
    setIsAiSummaryCollapsed((prev) => {
      const next = !prev;
      if (next && isAiChatCollapsed) setIsAiChatCollapsed(false);
      return next;
    });
  };

  const toggleChatPane = () => {
    setIsAiChatCollapsed((prev) => {
      const next = !prev;
      if (next && isAiSummaryCollapsed) setIsAiSummaryCollapsed(false);
      return next;
    });
  };

  const adjustAiSummaryFontSize = (delta) => {
    setAiSummaryFontSize((prev) => {
      const next = clampNumber(
        prev + delta,
        MIN_AI_SUMMARY_FONT_SIZE_PX,
        MAX_AI_SUMMARY_FONT_SIZE_PX,
      );
      sessionStorage.setItem('aiSummaryFontSizePx', String(next));
      return next;
    });
  };

  const adjustAiChatFontSize = (delta) => {
    setAiChatFontSize((prev) => {
      const next = clampNumber(
        prev + delta,
        MIN_AI_CHAT_FONT_SIZE_PX,
        MAX_AI_CHAT_FONT_SIZE_PX,
      );
      sessionStorage.setItem('aiChatFontSizePx', String(next));
      return next;
    });
  };

  useEffect(() => {
    const onResize = () => {
      const maxWidth = Math.max(MIN_AI_MODAL_WIDTH, window.innerWidth - 24);
      const defaultWidth = Math.min(maxWidth, getDefaultAiModalWidth());
      setAiModalWidth((prev) => {
        let next = Math.max(MIN_AI_MODAL_WIDTH, Math.min(maxWidth, prev));
        if (modalOnlyMode && aiModalOpen && !hasStoredAiModalWidthRef.current && defaultWidth > next) {
          next = defaultWidth;
        }
        return next;
      });

      const maxHeight = Math.max(MIN_AI_MODAL_HEIGHT, window.innerHeight - 32);
      const defaultHeight = Math.min(maxHeight, getDefaultAiModalHeight());
      setAiModalHeight((prev) => {
        let next = Math.max(MIN_AI_MODAL_HEIGHT, Math.min(maxHeight, prev));
        if (modalOnlyMode && aiModalOpen && !hasStoredAiModalHeightRef.current && defaultHeight > next) {
          next = defaultHeight;
        }
        return next;
      });
    };

    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, [modalOnlyMode, aiModalOpen]);

  useEffect(() => {
    if (!modalOnlyMode || !aiModalOpen) return undefined;
    if (hasStoredAiModalWidthRef.current && hasStoredAiModalHeightRef.current) return undefined;

    let rafA = 0;
    let rafB = 0;
    const timers = [];
    const syncModalOnlySize = () => {
      const targetWidth = getDefaultAiModalWidth();
      const targetHeight = getDefaultAiModalHeight();
      const widthThreshold = Math.max(MIN_AI_MODAL_WIDTH + 4, Math.round(window.innerWidth * 0.62));
      const heightThreshold = Math.max(MIN_AI_MODAL_HEIGHT + 4, Math.round(window.innerHeight * 0.58));

      if (!hasStoredAiModalWidthRef.current) {
        setAiModalWidth((prev) => {
          if (targetWidth > prev && prev <= widthThreshold) return targetWidth;
          return prev;
        });
      }
      if (!hasStoredAiModalHeightRef.current) {
        setAiModalHeight((prev) => {
          if (targetHeight > prev && prev <= heightThreshold) return targetHeight;
          return prev;
        });
      }
    };

    rafA = window.requestAnimationFrame(() => {
      rafB = window.requestAnimationFrame(syncModalOnlySize);
    });
    [120, 320, 680].forEach((delay) => {
      const timer = window.setTimeout(syncModalOnlySize, delay);
      timers.push(timer);
    });

    return () => {
      if (rafA) window.cancelAnimationFrame(rafA);
      if (rafB) window.cancelAnimationFrame(rafB);
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [modalOnlyMode, aiModalOpen]);

  return {
    state: {
      aiModalOpen,
      aiModalLoading,
      aiModalLoadingTitle,
      aiItemLoadingId,
      aiActiveItem,
      aiSummaryHtml,
      aiConversation,
      aiQuestion,
      aiAnswerLoading,
      aiSummaryRefreshing,
      aiSummaryStatusById,
      isAiSummaryCollapsed,
      isAiChatCollapsed,
      aiModalWidth,
      aiModalHeight,
      aiSummaryPaneRatio,
      aiSummaryFontSize,
      aiChatFontSize,
      aiQuestionInputHeight,
      aiBaseUrl,
      aiSpaceIconSrc,
      aiContributorIconSrc,
      aiContributorName,
      aiSummaryDirection,
    },
    refs: {
      aiThreadRef,
      aiModalRef,
      aiLayoutRef,
      aiQuestionInputRef,
    },
    actions: {
      setAiQuestion,
      setAiModalOpen,
      openAiSummaryModal,
      submitAiQuestion,
      clearAiConversation,
      resummarizeActiveItem,
      closeAiModal,
      startAiModalResize,
      resetAiModalWidth,
      startAiModalHeightResize,
      resetAiModalHeight,
      startAiQuestionInputResize,
      resetAiQuestionInputHeight,
      startAiPaneResize,
      resetAiSummaryPaneRatio,
      toggleSummaryPane,
      toggleChatPane,
      adjustAiSummaryFontSize,
      adjustAiChatFontSize,
    },
  };
}
