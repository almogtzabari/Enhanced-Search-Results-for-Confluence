// =========================================================
//                      API FUNCTIONS
// =========================================================
import { log } from '../config.js';
import { baseUrl, confluenceBodyCache } from '../state.js';

export async function fetchConfluenceBodyById(contentId, forceBodyFetch = false) {
    if (confluenceBodyCache.has(contentId) && !forceBodyFetch) {
        log.debug(`[Cache] Hit: Returning body for ${contentId}`);
        return confluenceBodyCache.get(contentId);
    }
    const apiUrl = `${baseUrl}/rest/api/content/${contentId}?expand=body.storage`;
    try {
        const response = await fetch(apiUrl, { method: 'GET', headers: { 'Accept': 'application/json' }, credentials: 'include' });
        if (!response.ok) throw new Error(`Workspace failed: ${response.statusText}`);
        const data = await response.json();
        const bodyHtml = data.body?.storage?.value || '(No content)';
        confluenceBodyCache.set(contentId, bodyHtml);
        log.debug(`[Cache] ${forceBodyFetch ? 'Forced ' : ''}Miss: Cached body for ${contentId}`);
        return bodyHtml;
    } catch (error) {
        log.error('[API] Error in fetchConfluenceBodyById:', error);
        throw error;
    }
}

export async function sendOpenAIRequest({ apiKey, apiUrl, model, messages }) {
    log.info('[OpenAI] (via BG) → POST', apiUrl);
    log.debug('[OpenAI] Payload:', { model, msgCount: messages.length });

    return new Promise((resolve, reject) => {
        const sanitizedBase = (apiUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const fullUrl = `${sanitizedBase}/chat/completions`;
        chrome.runtime.sendMessage(
            {
                type: 'openaiRequest',
                payload: { apiKey, apiUrl: fullUrl, model, messages }
            },
            (response) => {
                if (chrome.runtime.lastError) {
                    return reject(new Error(chrome.runtime.lastError.message));
                }
                if (!response?.success) {
                    return reject(new Error(response?.error || 'Unknown error from background'));
                }
                resolve(response.data);
            }
        );
    });
}
