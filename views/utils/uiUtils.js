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
        btn.classList.remove('loading', 'float-btn-expanded');
        btn.disabled = false;

        // Reset hover listeners if any
        if (btn._hoverEnter) btn.removeEventListener('mouseenter', btn._hoverEnter);
        if (btn._hoverLeave) btn.removeEventListener('mouseleave', btn._hoverLeave);
        delete btn._hoverEnter;
        delete btn._hoverLeave;

        // Apply small size immediately
        btn.classList.add('float-btn-small');
        btn.classList.remove('float-btn-expanded');

        if (label === '✅ Summary Available!') {
            btn.dataset.summaryAvailable = 'true';
            btn.dataset.loading = 'false';

            const expand = () => {
                btn.textContent = '✅ Summary Available!';
                btn.classList.add('float-btn-expanded');
                btn.classList.remove('float-btn-small');
            };
            const shrink = () => {
                btn.textContent = '✅';
                btn.classList.add('float-btn-small');
                btn.classList.remove('float-btn-expanded');
            };

            btn._hoverEnter = expand;
            btn._hoverLeave = shrink;
            btn.addEventListener('mouseenter', expand);
            btn.addEventListener('mouseleave', shrink);

            // Apply correct text on load
            if (btn.matches(':hover')) expand();
            else shrink();
        } else if (label === '🧠 Summarize') {
            btn.dataset.summaryAvailable = 'false';
            btn.dataset.loading = 'false';

            const expand = () => {
                btn.textContent = '🧠 Summarize';
                btn.classList.add('float-btn-expanded');
                btn.classList.remove('float-btn-small');
            };
            const shrink = () => {
                btn.textContent = '🧠';
                btn.classList.add('float-btn-small');
                btn.classList.remove('float-btn-expanded');
            };

            btn._hoverEnter = expand;
            btn._hoverLeave = shrink;
            btn.addEventListener('mouseenter', expand);
            btn.addEventListener('mouseleave', shrink);

            // Apply correct text on load
            if (btn.matches(':hover')) expand();
            else shrink();
        } else {
            // Fallback
            btn.textContent = label;
        }
    });
}