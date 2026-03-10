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

export async function withTimeout(promise, timeoutMs, errorMessage) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export function sendOpenAIRequest({ apiKey, apiUrl, model, messages, reasoningEffort }) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: 'openaiPort' });
    const fullUrl = normalizeResponsesUrl(apiUrl);

    const cleanup = () => {
      port.onMessage.removeListener(handleMessage);
      port.onDisconnect.removeListener(handleDisconnect);
    };

    const handleMessage = (response) => {
      if (response?.keepAlive) return;
      cleanup();
      if (!response?.success) {
        reject(new Error(response?.error || 'Unknown error from background'));
        return;
      }
      const data = response.data || {};
      resolve({ ...data, output_text: data.output_text || extractOutputText(data) });
    };

    const handleDisconnect = () => {
      cleanup();
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      }
    };

    port.onMessage.addListener(handleMessage);
    port.onDisconnect.addListener(handleDisconnect);
    port.postMessage({ apiKey, apiUrl: fullUrl, model, messages, reasoningEffort });
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
