// =========================================================
//                    UI UTILITY FUNCTIONS
// =========================================================
import { dom } from '../domElements.js';
import { log } from '../config.js';

export function triggerPoofEffect() {
    const el = dom.poofAudio || document.getElementById('poof-audio');
    if (el) {
        el.currentTime = 0;
        el.play().catch(e => log.warn('Poof sound error:', e));
    } else {
        log.warn('No poof-audio element found.');
    }
}

export function toggleClearIcon(inputElem, clearIcon) {
    if (inputElem && clearIcon) {
        clearIcon.style.display = inputElem.value.trim() ? 'inline' : 'none';
    }
}

export function showLoadingIndicator(show) {
    if (dom.globalLoadingOverlay) {
        dom.globalLoadingOverlay.style.display = show ? 'flex' : 'none';
    }
}

export function showNoResultsMessage() {
    const message = '<p>No results found.</p>';
    if (dom.treeContainer) dom.treeContainer.innerHTML = message;
    if (dom.tableContainer) dom.tableContainer.innerHTML = message;
}

export function resetSummaryButtons(buttons, label = '🧠 Summarize') {
    buttons.forEach(btn => {
        btn.textContent = label;
        btn.classList.remove('loading');
        btn.disabled = false;
    });
}