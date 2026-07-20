import { DEFAULT_AI_MODEL } from '../shared/constants.js';
import { normalizeResponsesUrl } from '../shared/openai.js';
import { ensureApiOriginPermission } from './permissions.js';
import { getLocal, getSync } from './storage.js';

export function resolveReasoningEffort(reasoningEffort, useHighReasoningEffort) {
  const normalized = typeof reasoningEffort === 'string' ? reasoningEffort.trim().toLowerCase() : '';
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') return normalized;
  return useHighReasoningEffort ? 'high' : undefined;
}

function extractOutputText(responseData) {
  if (!responseData) return '';
  if (typeof responseData.output_text === 'string' && responseData.output_text.trim()) {
    return responseData.output_text;
  }
  if (Array.isArray(responseData.output)) {
    const chunks = [];
    responseData.output.forEach((item) => {
      if (!Array.isArray(item?.content)) return;
      item.content.forEach((contentItem) => {
        if (contentItem?.type === 'output_text' && typeof contentItem.text === 'string') {
          chunks.push(contentItem.text);
        }
      });
    });
    return chunks.join('\n').trim();
  }
  return '';
}

export async function withTimeout(promise, timeoutMs, errorMessage, onTimeout) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(errorMessage));
      if (typeof onTimeout === 'function') {
        try {
          onTimeout();
        } catch {
          // Ignore timeout side-effect failures.
        }
      }
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function createAbortError() {
  const err = new Error('Request aborted');
  err.name = 'AbortError';
  return err;
}

export function sendOpenAIRequest({
  apiKey,
  apiUrl,
  model,
  messages,
  reasoningEffort,
  signal,
}) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: 'openaiPort' });
    const fullUrl = normalizeResponsesUrl(apiUrl);
    let settled = false;

    const settle = (action, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      action(value);
    };

    const cleanup = () => {
      port.onMessage.removeListener(handleMessage);
      port.onDisconnect.removeListener(handleDisconnect);
      if (signal?.removeEventListener) {
        signal.removeEventListener('abort', handleAbort);
      }
      try {
        port.disconnect();
      } catch {
        // Ignore an already-disconnected port.
      }
    };

    const handleMessage = (response) => {
      if (response?.keepAlive) return;
      if (!response?.success) {
        settle(reject, new Error(response?.error || 'Unknown error from background'));
        return;
      }
      const data = response.data || {};
      settle(resolve, { ...data, output_text: data.output_text || extractOutputText(data) });
    };

    const handleDisconnect = (disconnectedPort) => {
      if (signal?.aborted) {
        settle(reject, createAbortError());
        return;
      }
      const message = disconnectedPort?.error?.message
        || port?.error?.message
        || chrome.runtime.lastError?.message
        || 'OpenAI connection closed';
      settle(reject, new Error(message));
    };

    const handleAbort = () => {
      if (settled) return;
      settle(reject, createAbortError());
    };

    if (signal?.aborted) {
      handleAbort();
      return;
    }

    port.onMessage.addListener(handleMessage);
    port.onDisconnect.addListener(handleDisconnect);
    if (signal?.addEventListener) {
      signal.addEventListener('abort', handleAbort, { once: true });
    }

    try {
      port.postMessage({
        apiKey,
        apiUrl: fullUrl,
        model,
        messages,
        reasoningEffort,
      });
    } catch (err) {
      settle(reject, err instanceof Error ? err : new Error('Failed to send OpenAI request'));
    }
  });
}

export async function getAiRuntimeSettings({ requireApiKey = false, requestEndpointPermission = false } = {}) {
  const [syncData, localData] = await Promise.all([
    getSync(['openaiApiKey', 'customApiEndpoint', 'selectedAiModel', 'reasoningEffort', 'useHighReasoningEffort']),
    getLocal(['openaiApiKey']),
  ]);
  const localApiKey = typeof localData.openaiApiKey === 'string' ? localData.openaiApiKey.trim() : '';
  const legacySyncApiKey = typeof syncData.openaiApiKey === 'string' ? syncData.openaiApiKey.trim() : '';

  const settings = {
    apiKey: localApiKey || legacySyncApiKey,
    apiUrl: syncData.customApiEndpoint?.trim() || 'https://api.openai.com/v1',
    model: syncData.selectedAiModel || DEFAULT_AI_MODEL,
    reasoningEffort: resolveReasoningEffort(syncData.reasoningEffort, syncData.useHighReasoningEffort),
  };

  if (requireApiKey && !settings.apiKey) {
    throw new Error('An OpenAI API key is required. Configure it in extension options.');
  }

  let endpointOrigin = '';
  try {
    endpointOrigin = new URL(normalizeResponsesUrl(settings.apiUrl)).origin;
  } catch {
    throw new Error('Invalid OpenAI API endpoint URL. Check extension options.');
  }

  const permissionResult = await ensureApiOriginPermission(
    endpointOrigin,
    { requestIfMissing: requestEndpointPermission },
  );
  if (!permissionResult.granted) {
    if (permissionResult.reason === 'missing_permission') {
      throw new Error('OpenAI endpoint permission is missing. Open extension Options and click "Grant Endpoint Permission".');
    }
    throw new Error('Permission denied for the OpenAI endpoint domain. Please allow it and try again.');
  }

  return settings;
}
