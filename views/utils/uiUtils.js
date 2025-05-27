// =========================================================
//                    UI UTILITY FUNCTIONS
// =========================================================
import { dom } from '../domElements.js';
import { log } from '../config.js';

export function triggerPoofEffect() {
    if (dom.poofAudio) {
        dom.poofAudio.currentTime = 0;
        dom.poofAudio.play().catch(e => log.warn('Poof sound error:', e));
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