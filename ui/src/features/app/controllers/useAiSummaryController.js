import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getLocal } from '../../../services/storage.js';
import {
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

// Owns AI modal behavior for both views mode and content-modal iframe mode.
export function useAiSummaryController({
  baseUrl,
  modalOnlyMode,
  modalContentId,
  modalContentTitle,
  enableSummaries,
  allResults,
  openNoticeDialog,
  openConfirmDialog,
}) {
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiModalLoading, setAiModalLoading] = useState(false);
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
    if (!Number.isFinite(saved)) return getDefaultAiModalWidth();
    const maxWidth = Math.max(MIN_AI_MODAL_WIDTH, window.innerWidth - 24);
    return clampNumber(saved, MIN_AI_MODAL_WIDTH, maxWidth);
  });
  const [aiModalHeight, setAiModalHeight] = useState(() => {
    const saved = Number.parseFloat(sessionStorage.getItem('aiModalHeight') || '');
    if (!Number.isFinite(saved)) return getDefaultAiModalHeight();
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
  const modalOnlyInitializedRef = useRef(false);
  const shouldAutoFocusAiQuestionRef = useRef(false);

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
Contributor: ${pageData.history?.createdBy?.displayName || 'Unknown'}
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
    const preflightStoredSummary = !forceResummarize
      ? await getStoredSummary(contentId, effectiveBaseUrl)
      : null;

    if (!preflightStoredSummary?.summaryHtml) {
      try {
        await getAiRuntimeSettings({ requireApiKey: true, requestEndpointPermission: false });
      } catch (err) {
        const message = err?.message || 'Unknown error';
        const isApiKeyIssue = /api key/i.test(message);
        openNoticeDialog({
          title: isApiKeyIssue ? 'OpenAI API Key Missing' : 'AI Setup Required',
          message: isApiKeyIssue
            ? 'Please set your OpenAI API key in the extension Options page first.'
            : message,
          tone: 'error',
        });
        return;
      }
    }

    setAiItemLoadingId(contentId);
    setAiSummaryStatusById((prev) => ({ ...prev, [contentId]: 'loading' }));
    setAiContextBaseUrl(effectiveBaseUrl);
    const useBlockingLoader = !(forceResummarize && aiModalOpen);
    if (useBlockingLoader) setAiModalLoading(true);
    setAiActiveItem({
      ...pageData,
      ancestors: Array.isArray(pageData.ancestors) ? pageData.ancestors : [],
    });
    if (!aiModalOpen) setAiModalOpen(true);

    try {
      let resolvedPageData = pageData;
      try {
        const metadata = await fetchConfluenceMetadataById(effectiveBaseUrl, contentId);
        resolvedPageData = {
          ...pageData,
          ...metadata,
          space: { ...(pageData.space || {}), ...(metadata.space || {}) },
          history: {
            ...(pageData.history || {}),
            ...(metadata.history || {}),
            createdBy: {
              ...(pageData.history?.createdBy || {}),
              ...(metadata.history?.createdBy || {}),
            },
          },
          _links: { ...(pageData._links || {}), ...(metadata._links || {}) },
        };
      } catch (metaErr) {
        console.warn('[V2 Preact] Metadata fetch failed, using existing page data:', metaErr);
      }

      resolvedPageData = await enrichVisualMetadata(effectiveBaseUrl, resolvedPageData);

      let summaryHtml = '';
      let userPromptText = '';
      let conversation = null;

      const storedSummary = !forceResummarize
        ? preflightStoredSummary
        : null;

      if (storedSummary?.summaryHtml) {
        summaryHtml = sanitizeHtmlFragment(storedSummary.summaryHtml);
        userPromptText = storedSummary.userPrompt || '';
      } else {
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
          title: resolvedPageData.title || pageData.title,
          summaryHtml,
          userPrompt: userPromptText,
          timestamp: Date.now(),
        });
      }

      if (!userPromptText) userPromptText = await buildUserPrompt(resolvedPageData, false, effectiveBaseUrl);

      const storedConversation = await getStoredConversation(contentId, effectiveBaseUrl);
      if (Array.isArray(storedConversation?.messages) && !forceResummarize) {
        conversation = storedConversation.messages.map((msg) => (
          msg.role === 'assistant'
            ? { ...msg, content: sanitizeHtmlFragment(msg.content || '') }
            : msg
        ));
      } else {
        conversation = createBaseConversation(userPromptText, summaryHtml);
        await storeConversation(contentId, effectiveBaseUrl, conversation);
      }

      setAiActiveItem(resolvedPageData);
      setAiSummaryHtml(summaryHtml);
      setAiUserPrompt(userPromptText);
      setAiConversation(conversation);
      setAiQuestion('');
      setAiSummaryStatusById((prev) => ({ ...prev, [contentId]: 'ready' }));
      setAiSummaryCheckedById((prev) => ({ ...prev, [contentId]: true }));
    } catch (err) {
      console.error('[V2 Preact] AI summary failed:', err);
      openNoticeDialog({
        title: 'Failed to Summarize Page',
        message: err.message || 'Unknown error',
        tone: 'error',
      });
      setAiSummaryStatusById((prev) => ({
        ...prev,
        [contentId]: prev[contentId] === 'ready' ? 'ready' : 'idle',
      }));
      setAiSummaryCheckedById((prev) => ({ ...prev, [contentId]: true }));
    } finally {
      setAiItemLoadingId(null);
      setAiModalLoading(false);
      setAiSummaryRefreshing(false);
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
    setAiContextBaseUrl('');
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
          type: 'page',
          _links: {},
          space: {},
          history: {},
          version: {},
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
  }, [modalOnlyMode, modalContentId, modalContentTitle, baseUrl]);

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
  }, [baseUrl]);

  useEffect(() => {
    const ids = collectSummaryCandidateIds(allResults);
    const unchecked = ids.filter((id) => !aiSummaryCheckedById[id] && aiItemLoadingId !== id);
    if (unchecked.length === 0) return;

    let alive = true;
    (async () => {
      const checks = await Promise.all(
        unchecked.map(async (id) => {
          try {
            const stored = await getStoredSummary(id, baseUrl);
            return { id, hasSummary: !!stored?.summaryHtml };
          } catch {
            return { id, hasSummary: false };
          }
        }),
      );
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
  const aiContributorIconUrl = useMemo(() => (
    resolveConfluenceIconUrl(aiBaseUrl, aiActiveItem?.history?.createdBy?.profilePicture?.path || '', fallbackUserIcon)
  ), [aiBaseUrl, aiActiveItem]);
  const aiContributorName = useMemo(
    () => aiActiveItem?.history?.createdBy?.displayName || aiActiveItem?.history?.createdBy?.username || 'Unknown',
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

    const onMove = (moveEvent) => {
      const delta = direction === 'right'
        ? moveEvent.clientX - startX
        : startX - moveEvent.clientX;
      const maxWidth = Math.max(MIN_AI_MODAL_WIDTH, window.innerWidth - 24);
      const nextWidth = Math.max(MIN_AI_MODAL_WIDTH, Math.min(maxWidth, startWidth + (2 * delta)));
      setAiModalWidth(nextWidth);
      sessionStorage.setItem('aiModalWidth', String(nextWidth));
    };

    const onStop = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onStop);
      document.body.style.cursor = '';
    };

    document.body.style.cursor = 'ew-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onStop);
  };

  const resetAiModalWidth = () => {
    setAiModalWidth(getDefaultAiModalWidth());
    sessionStorage.removeItem('aiModalWidth');
  };

  const startAiModalHeightResize = (event, edge = 'bottom') => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = aiModalRef.current?.offsetHeight || aiModalHeight;

    const onMove = (moveEvent) => {
      const delta = moveEvent.clientY - startY;
      const maxHeight = Math.max(MIN_AI_MODAL_HEIGHT, window.innerHeight - 32);
      const adjustedDelta = edge === 'top' ? -delta : delta;
      const nextHeight = Math.max(MIN_AI_MODAL_HEIGHT, Math.min(maxHeight, startHeight + (2 * adjustedDelta)));
      setAiModalHeight(nextHeight);
      sessionStorage.setItem('aiModalHeight', String(nextHeight));
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

  const resetAiModalHeight = () => {
    setAiModalHeight(getDefaultAiModalHeight());
    sessionStorage.removeItem('aiModalHeight');
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
      setAiModalWidth((prev) => Math.max(MIN_AI_MODAL_WIDTH, Math.min(maxWidth, prev)));
      const maxHeight = Math.max(MIN_AI_MODAL_HEIGHT, window.innerHeight - 32);
      setAiModalHeight((prev) => Math.max(MIN_AI_MODAL_HEIGHT, Math.min(maxHeight, prev)));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return {
    state: {
      aiModalOpen,
      aiModalLoading,
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
