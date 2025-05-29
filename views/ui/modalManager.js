// =========================================================
//                    MODAL MANAGER
// =========================================================
import { log, qaSystemPrompt } from '../config.js';
import { detectDirection, escapeHtml, buildConfluenceUrl } from '../utils/generalUtils.js';
import { getUserPrompt, renderConversationThread, handleQaSubmit, handleClearConversation, handleResummarize } from '../features/aiFeatures.js';
import { getStoredConversation, storeConversation } from '../services/dbService.js';
import * as state from '../state.js';

export function showConfirmationDialog(messageHtml, onConfirm) {
    log.debug('[Dialog] Showing confirmation');
    const existingDialog = document.getElementById('dialog-overlay');
    if (existingDialog) existingDialog.remove();

    const dialogOverlay = document.createElement('div');
    dialogOverlay.id = 'dialog-overlay';
    dialogOverlay.className = 'dialog-overlay';
    dialogOverlay.innerHTML = `
        <div class="dialog-content">
            <span class="dialog-close">&times;</span>
            <p>${messageHtml}</p>
            <div class="dialog-actions">
                <button id="dialog-cancel">Cancel</button>
                <button id="dialog-confirm">Confirm</button>
            </div>
        </div>`;
    document.body.appendChild(dialogOverlay);

    const closeDialog = () => dialogOverlay.remove();
    dialogOverlay.querySelector('.dialog-close').onclick = closeDialog;
    dialogOverlay.querySelector('#dialog-cancel').onclick = closeDialog;
    dialogOverlay.querySelector('#dialog-confirm').onclick = () => {
        closeDialog();
        log.info('[Dialog] ✔ User confirmed');
        onConfirm();
    };
    dialogOverlay.onclick = (e) => { if (e.target === dialogOverlay) closeDialog(); };
}


export function setupTextareaResizer(textarea) {
    const resizer = document.getElementById('qa-resizer');
    if (!textarea || !resizer) return;

    resizer.ondblclick = () => {
        textarea.style.height = '60px';
        sessionStorage.removeItem('qaInputHeight');
    };
    resizer.onmousedown = (e) => {
        let isResizing = true;
        const startY = e.clientY;
        const startHeight = parseInt(window.getComputedStyle(textarea).height, 10);
        document.body.style.cursor = 'ns-resize';
        const move = (ev) => {
            if (!isResizing) return;
            const newHeight = Math.max(60, startHeight - (ev.clientY - startY));
            textarea.style.height = `${newHeight}px`;
            sessionStorage.setItem('qaInputHeight', newHeight);
        };
        const stop = () => {
            isResizing = false;
            document.body.style.cursor = '';
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', stop);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', stop);
    };
}


export async function showSummaryModal(summaryText, pageData, bodyHtml, baseUrl, providedPrompt = null) {
    const modal = document.getElementById('summary-modal');
    const modalBody = document.getElementById('modal-body');
    const modalClose = document.getElementById('modal-close');
    const summaryTitle = document.getElementById('summary-title');


    if (!modal || !modalBody || !modalClose || !summaryTitle) {

        log.error('Summary modal DOM elements not found');
        return;
    }
    log.debug('Showing summary modal for', pageData.id);
    modalBody.scrollTop = 0;
    summaryTitle.innerHTML = `<strong>🧠 AI Summary</strong><br><a href="${buildConfluenceUrl(pageData._links.webui)}" target="_blank" title="${escapeHtml(pageData.title)}">${escapeHtml(pageData.title)}</a>`;

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = summaryText;
    tempDiv.querySelectorAll('p, li, h2, h3').forEach(el => el.setAttribute('dir', detectDirection(el.textContent)));

    const summaryDiv = document.createElement('div');
    summaryDiv.id = 'summary-content';
    summaryDiv.innerHTML = tempDiv.innerHTML;

    modalBody.innerHTML = `
        <div id="summary-thread-wrapper" style="display: flex; flex-direction: column; gap: 12px;">
            ${summaryDiv.outerHTML}
            <h3 class="conversation-title">💬 Follow-Up Questions</h3>
            <div id="qa-thread"></div>
            <button id="qa-scroll-top" title="Scroll to summary" style="display: none; align-self: flex-end;">⬆</button>
        </div>`;

    const modalContent = modal.querySelector('.modal-content');
    let qaInputArea = modalContent.querySelector('#qa-input-area');
    if (qaInputArea) qaInputArea.remove();

    qaInputArea = document.createElement('div');
    qaInputArea.id = 'qa-input-area';
    qaInputArea.innerHTML = `
        <div class="qa-input-wrapper">
            <div class="textarea-resizer" id="qa-resizer"></div>
            <textarea id="qa-input" placeholder="Ask a follow-up question..."></textarea>
        </div>
        <div class="qa-button-row">
            <button id="qa-submit">❓ Ask</button>
            <button id="qa-resummarize">🧠 Re-summarize</button>
            <button id="qa-clear">🧹 Clear Conversation</button>
        </div>
        <div id="resummarize-loading-overlay" style="display: none;">
            <div class="loader small-loader"></div>
            Regenerating...
        </div>`;
    modalContent.appendChild(qaInputArea);

    const qaThread = document.getElementById('qa-thread');
    const qaInput = document.getElementById('qa-input');
    const qaSubmit = document.getElementById('qa-submit');
    const qaClear = document.getElementById('qa-clear');
    const qaResummarize = document.getElementById('qa-resummarize');
    const qaScrollBtn = document.getElementById('qa-scroll-top');

    const savedHeight = sessionStorage.getItem('qaInputHeight');
    if (qaInput && savedHeight) qaInput.style.height = `${savedHeight}px`;
    else if (qaInput) qaInput.style.height = '60px';
    if (qaInput) {
        setupTextareaResizer(qaInput);
        // Always focus the textarea when modal opens
        setTimeout(() => qaInput.focus(), 50);
    }

    const contentId = pageData.id;
    const storedConv = await getStoredConversation(contentId, baseUrl);
    let conversation = storedConv?.messages;

    let userPromptForQA = providedPrompt || '';
    if (!conversation) {
        if (!userPromptForQA) {
            userPromptForQA = await getUserPrompt(pageData);
        }
        conversation = [
            { role: 'system', content: qaSystemPrompt },
            { role: 'user', content: userPromptForQA },
            { role: 'assistant', content: summaryText }
        ];
    }
    state.conversationHistories.set(contentId, conversation);
    await storeConversation(contentId, baseUrl, conversation);
    if (qaThread) renderConversationThread(qaThread, conversation);

    if (qaSubmit) qaSubmit.onclick = () => handleQaSubmit(contentId, qaInput, qaThread, qaSubmit, conversation);
    if (qaInput) {
        qaInput.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleQaSubmit(contentId, qaInput, qaThread, qaSubmit, conversation);
            }
        };
        qaInput.oninput = () => qaInput.setAttribute('dir', detectDirection(qaInput.value));
    }
    if (qaClear) qaClear.onclick = () => handleClearConversation(contentId, qaThread, userPromptForQA, summaryText);
    if (qaResummarize) qaResummarize.onclick = () => handleResummarize(pageData, bodyHtml);
    if (qaScrollBtn) qaScrollBtn.onclick = () => {
        const el = document.getElementById('modal-body');
        if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
    };

    modalBody.onscroll = () => {
        if (qaScrollBtn) qaScrollBtn.style.display = modalBody.scrollTop > 100 ? 'inline-block' : 'none';
    };

    requestAnimationFrame(() => {
        if (modalBody.scrollHeight <= modalBody.clientHeight) {

            if (qaScrollBtn) qaScrollBtn.style.display = 'none';
        }
    });

    modal.style.display = 'flex';
    modalClose.onclick = () => modal.style.display = 'none';
    window.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
    document.onkeydown = (e) => { if (e.key === 'Escape') modal.style.display = 'none'; };

}

export function setupModalResizers() {
    const resizerRight = document.getElementById('modal-resizer');
    const resizerLeft = document.getElementById('modal-resizer-left');
    const resizable = document.getElementById('resizable-modal');

    if (!resizable || !resizerRight || !resizerLeft) return;
    const savedWidth = sessionStorage.getItem('modalWidth');
    if (savedWidth) resizable.style.width = `${savedWidth}px`;

    const startResize = (e, direction) => {
        e.preventDefault();
        const startX = e.clientX, startWidth = resizable.offsetWidth;
        const move = (ev) => {
            const delta = (direction === 'right' ? ev.clientX - startX : startX - ev.clientX);
            const newWidth = Math.max(300, startWidth + 2 * delta);
            resizable.style.width = `${newWidth}px`;
            sessionStorage.setItem('modalWidth', newWidth);
        };
        const stop = () => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', stop);
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', stop);
    };
    resizerRight.onmousedown = (e) => startResize(e, 'right');
    resizerLeft.onmousedown = (e) => startResize(e, 'left');
    resizerRight.ondblclick = resizerLeft.ondblclick = () => {
        resizable.style.width = '600px';
        sessionStorage.removeItem('modalWidth');
    };
}