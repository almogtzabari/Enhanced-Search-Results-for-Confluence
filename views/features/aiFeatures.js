// =========================================================
//                    AI FEATURES
// =========================================================
import * as state from '../state.js';
import { log, summarySystemPrompt, qaSystemPrompt } from '../config.js';
import { fetchConfluenceBodyById, sendOpenAIRequest } from '../services/apiService.js';
import { getStoredSummary, storeSummary, storeConversation } from '../services/dbService.js';
import { sanitizeHtmlWithDOM, detectDirection, formatDate, escapeHtml, buildConfluenceUrl } from '../utils/generalUtils.js';
import { resetSummaryButtons } from '../utils/uiUtils.js';
import { showConfirmationDialog, showSummaryModal } from '../ui/modalManager.js'; // showSummaryModal is called here

export async function getUserPrompt(pageData) {
    log.debug('[Prompt] Building for', pageData.id);
    const bodyHtmlRaw = await fetchConfluenceBodyById(pageData.id);
    const bodyHtml = sanitizeHtmlWithDOM(bodyHtmlRaw);
    const localData = await new Promise(resolve => chrome.storage.local.get(['customUserPrompt'], resolve));
    const userPrompt = (localData.customUserPrompt || '').trim();
    const contentDetails = `
        --- Content Details ---\n
        Title: ${pageData.title}\n
        Contributor: ${pageData.history?.createdBy?.displayName || 'Unknown'}\n
        Created: ${pageData.history.createdDate || 'N/A'}\n
        Modified: ${pageData.version?.when ? formatDate(pageData.version.when) : 'N/A'}\n
        SpaceIcon: ${pageData.space?.icon?.path ? `${state.baseUrl}${pageData.space.icon.path}` : `${state.baseUrl}/images/logo/default-space-logo.svg`}\n
        Type: ${pageData.type}\nSpace: ${pageData.space?.name || 'N/A'}\n
        Parent Title: ${pageData.parentTitle || 'N/A'}\n
        URL: ${buildConfluenceUrl(pageData._links.webui)}\n
        Content (HTML): ${bodyHtml}`.trim();
    return (userPrompt ? `${userPrompt}\n\n` : '') + contentDetails;
}

export function renderConversationThread(container, conversation) {
    if (!container) return;
    container.innerHTML = '';
    conversation.slice(3).forEach(msg => {
        const div = document.createElement('div');
        div.className = `qa-entry ${msg.role}`;
        const dir = detectDirection(msg.content);
        div.setAttribute('dir', dir);
        div.style.textAlign = dir === 'rtl' ? 'right' : 'left';
        div.innerHTML = msg.role === 'assistant' ? msg.content : escapeHtml(msg.content);
        container.appendChild(div);
    });
    requestAnimationFrame(() => {
        if (container.parentElement) {
             container.parentElement.scrollTo({ top: container.parentElement.scrollHeight, behavior: 'smooth' });
        }
    });
}

export async function handleQaSubmit(contentId, inputEl, threadEl, submitBtn) {
    const question = inputEl.value.trim();
    if (!question) return;
    inputEl.value = '';
    inputEl.setAttribute('dir', 'ltr');
    submitBtn.disabled = true;

    const messages = state.conversationHistories.get(contentId);
    if (!messages) {
        log.error('Conversation history not found for contentId:', contentId);
        submitBtn.disabled = false;
        return;
    }
    messages.push({ role: 'user', content: question });

    const userMsg = document.createElement('div');
    userMsg.className = 'qa-entry user';
    userMsg.dir = detectDirection(question);
    userMsg.textContent = question;
    threadEl.appendChild(userMsg);

    const typingBubble = document.createElement('div');
    typingBubble.className = 'qa-entry assistant typing-bubble';
    typingBubble.innerHTML = '<span class="typing-dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>';
    threadEl.appendChild(typingBubble);

    requestAnimationFrame(() => {
        const modalBody = document.getElementById('modal-body');
        if (modalBody) {
            modalBody.scrollTo({ top: modalBody.scrollHeight, behavior: 'smooth' });
        }
    });

    try {
        const { openaiApiKey, customApiEndpoint } = await new Promise(res => chrome.storage.sync.get(['openaiApiKey', 'customApiEndpoint'], res));
        const result = await sendOpenAIRequest({ apiKey: openaiApiKey, apiUrl: customApiEndpoint?.trim() || 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o', messages });
        const answer = result.choices?.[0]?.message?.content || '[No response]';
        messages.push({ role: 'assistant', content: answer });
        storeConversation(contentId, state.baseUrl, messages);
        typingBubble.remove();
        const reply = document.createElement('div');
        reply.className = 'qa-entry assistant';
        reply.dir = detectDirection(answer);
        reply.innerHTML = answer;
        threadEl.appendChild(reply);
        requestAnimationFrame(() => reply.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (err) {
        log.error('[QA] Error:', err);
        alert('Failed to get answer.');
        const bubble = threadEl.querySelector('.typing-bubble');
        if (bubble) bubble.remove();
    } finally { submitBtn.disabled = false; }
}

export function handleClearConversation(contentId, threadEl, userPrompt, summaryText) {
    showConfirmationDialog('<h2>Are you sure you want to clear this conversation?</h2>', () => {
        triggerPoofEffect(); // From uiUtils, needs to be imported or passed
        const newConversation = [{ role: 'system', content: qaSystemPrompt }, { role: 'user', content: userPrompt }, { role: 'assistant', content: summaryText }];
        state.conversationHistories.set(contentId, newConversation);
        storeConversation(contentId, state.baseUrl, newConversation);
        renderConversationThread(threadEl, newConversation);
    });
}

export async function handleResummarize(pageData, bodyHtml) {
    showConfirmationDialog('<h2>Are you sure you want to regenerate the summary?</h2>This will replace the current summary and reset the conversation.', async () => {
        const contentId = pageData.id;
        const resummarizeOverlay = document.getElementById('resummarize-loading-overlay');
        if (resummarizeOverlay) resummarizeOverlay.style.display = 'flex';

        const allButtons = document.querySelectorAll(`.summarize-button[data-id="${contentId}"]`);
        resetSummaryButtons(allButtons, 'Re-summarizing...');
        allButtons.forEach(b => {
            b.disabled = true;
            b.classList.add('loading');
        });
        try {
            const userPrompt = await getUserPrompt(pageData);
            const { openaiApiKey: apiKey, customApiEndpoint } = await new Promise(res => chrome.storage.sync.get(['openaiApiKey', 'customApiEndpoint'], res));
            const result = await sendOpenAIRequest({ apiKey, apiUrl: customApiEndpoint?.trim() || 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o', messages: [{ role: 'system', content: summarySystemPrompt }, { role: 'user', content: userPrompt }] });
            const newSummary = result.choices[0].message.content;
            state.summaryCache.set(contentId, newSummary);
            await storeSummary({ contentId, baseUrl: state.baseUrl, title: pageData.title, summaryHtml: newSummary, bodyHtml });
            const newConversation = [{ role: 'system', content: qaSystemPrompt }, { role: 'user', content: userPrompt }, { role: 'assistant', content: newSummary }];
            state.conversationHistories.set(contentId, newConversation);
            await storeConversation(contentId, state.baseUrl, newConversation);
            showSummaryModal(newSummary, pageData, bodyHtml); // Re-render the modal
            resetSummaryButtons(allButtons, '✅ Summary Available!');
        } catch (err) {
            log.error('Re-summarize failed:', err);
            alert('Failed to regenerate summary.');
            resetSummaryButtons(allButtons, '🧠 Summarize');
        } finally {
            if (resummarizeOverlay) resummarizeOverlay.style.display = 'none';
            const qaSubmitBtn = document.getElementById('qa-submit');
            const qaClearBtn = document.getElementById('qa-clear');
            const qaResummarizeBtn = document.getElementById('qa-resummarize');
            if(qaSubmitBtn) qaSubmitBtn.disabled = false;
            if(qaClearBtn) qaClearBtn.disabled = false;
            if(qaResummarizeBtn) qaResummarizeBtn.disabled = false;
        }
    });
}


export async function handleSummarizeClick(event) {
    const btn = event.target.closest('.summarize-button');
    if (!btn) return;
    const contentId = btn.dataset.id;
    const pageData = state.allResults.find(r => r.id === contentId);
    if (!pageData) return log.warn('Content not found for summarization', contentId);

    const allButtons = document.querySelectorAll(`.summarize-button[data-id="${contentId}"]`);
    resetSummaryButtons(allButtons, 'Summarizing...');
    allButtons.forEach(b => {
        b.disabled = true;
        b.classList.add('loading');
    });

    try {
        const bodyHtml = await fetchConfluenceBodyById(contentId).then(sanitizeHtmlWithDOM);
        const stored = await getStoredSummary(contentId, state.baseUrl);
        if (stored?.summaryHtml) {
            log.debug(`[DB] Using cached summary for ${contentId}`);
            state.summaryCache.set(contentId, stored.summaryHtml);
            showSummaryModal(stored.summaryHtml, pageData, bodyHtml);
            resetSummaryButtons(allButtons, '✅ Summary Available!');
        } else {
            log.debug(`[AI] Requesting new summary for ${contentId}`);
            const { openaiApiKey, customApiEndpoint } = await new Promise(res => chrome.storage.sync.get(['openaiApiKey', 'customApiEndpoint'], res));
            if (!openaiApiKey) {
                alert('OpenAI API key not set.');
                resetSummaryButtons(allButtons);
                return;
            }
            const userPrompt = await getUserPrompt(pageData);
            const result = await sendOpenAIRequest({ apiKey: openaiApiKey, apiUrl: customApiEndpoint?.trim() || 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o', messages: [{ role: 'system', content: summarySystemPrompt }, { role: 'user', content: userPrompt }] });
            const summary = result.choices[0].message.content;
            state.summaryCache.set(contentId, summary);
            await storeSummary({ contentId, baseUrl: state.baseUrl, title: pageData.title, summaryHtml: summary, bodyHtml });
            showSummaryModal(summary, pageData, bodyHtml);
            resetSummaryButtons(allButtons, '✅ Summary Available!');
        }
    } catch (err) {
        log.error('[Summary] Failed to summarize:', err);
        alert(`Failed to summarize content: ${err.message}`);
        resetSummaryButtons(allButtons, '🧠 Summarize');
    }
}
// Need to import triggerPoofEffect if it's called directly inside handleClearConversation
import { triggerPoofEffect } from '../utils/uiUtils.js';