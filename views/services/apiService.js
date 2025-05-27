// =========================================================
//                      API FUNCTIONS
// =========================================================
import { log, USE_LOCAL_PROXY } from '../config.js';
import { baseUrl, confluenceBodyCache } from '../state.js';

export async function fetchConfluenceBodyById(contentId) {
    if (confluenceBodyCache.has(contentId)) {
        log.debug(`[Cache] Returning body for ${contentId}`);
        return confluenceBodyCache.get(contentId);
    }
    const apiUrl = `${baseUrl}/rest/api/content/${contentId}?expand=body.storage`;
    try {
        const response = await fetch(apiUrl, { method: 'GET', headers: { 'Accept': 'application/json' }, credentials: 'include' });
        if (!response.ok) throw new Error(`Workspace failed: ${response.statusText}`);
        const data = await response.json();
        const bodyHtml = data.body?.storage?.value || '(No content)';
        confluenceBodyCache.set(contentId, bodyHtml);
        log.debug(`[Cache] Fetched body for ${contentId}`);
        return bodyHtml;
    } catch (error) {
        log.error('[API] Error in fetchConfluenceBodyById:', error);
        throw error;
    }
}

export async function sendOpenAIRequest({ apiKey, apiUrl, model, messages }) {
    log.info('[OpenAI] → POST', apiUrl);
    log.debug('[OpenAI] Payload:', { model, msgCount: messages.length });
    const useProxy = USE_LOCAL_PROXY;
    const url = useProxy ? 'http://localhost:3000/proxy' : apiUrl;
    const body = useProxy ? JSON.stringify({ apiKey, apiUrl, model, messages }) : JSON.stringify({ model, messages });
    const headers = useProxy ? { 'Content-Type': 'application/json' } : { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    try {
        const response = await fetch(url, { method: 'POST', headers, body });
        if (!response.ok) {
            const errorText = await response.text();
            log.error('[OpenAI] HTTP Error', response.status, errorText.slice(0, 200));
            throw new Error(`OpenAI request failed: ${response.statusText}`);
        }
        const result = await response.json();
        log.info('[OpenAI] ✓ Response OK');
        log.debug('[OpenAI] Meta:', { model: result.model, usage: result.usage });
        return result;
    } catch (error) {
        log.error('[OpenAI] Fetch/Request Error:', error);
        throw error;
    }
}