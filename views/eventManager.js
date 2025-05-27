// =========================================================
//                    EVENT MANAGER
// =========================================================
import { dom } from './domElements.js';
import * as state from './state.js';
import { log, SCROLL_THRESHOLD_PX } from './config.js';
import { toggleClearIcon } from './utils/uiUtils.js';
import { performNewSearch } from './features/searchController.js';
import { switchToTreeView, handleTreeArrowClick } from './ui/treeView.js';
import { switchToTableView } from './ui/tableView.js';
import { setupFilterInputEventListeners } from './ui/filterControls.js';
import { setupModalResizers } from './ui/modalManager.js';
import { handleSummarizeClick } from './features/aiFeatures.js';
import { loadMoreResults } from './core/dataFetcher.js';


export function attachScrollListenerTo(target) {
    if (!target) return;
    if (state.currentScrollTarget && state.currentScrollTarget !== target) {
        state.currentScrollTarget.removeEventListener('scroll', handleInfiniteScroll);
        state.currentScrollTarget.removeEventListener('scroll', handleScrollToTopButtonVisibility);
    }
    if (state.currentScrollTarget !== target) {
        state.setCurrentScrollTarget(target);
        state.currentScrollTarget.addEventListener('scroll', handleInfiniteScroll);
        state.currentScrollTarget.addEventListener('scroll', handleScrollToTopButtonVisibility);
    }
}

function handleScrollToTopButtonVisibility() {
    if (!state.currentScrollTarget || !dom.scrollToTopButton) return;
    dom.scrollToTopButton.style.display = state.currentScrollTarget.scrollTop > 200 ? 'block' : 'none';
}

function handleInfiniteScroll() {
    if (!state.currentScrollTarget) return;
    const reachedBottom = state.currentScrollTarget.scrollTop + state.currentScrollTarget.clientHeight >= state.currentScrollTarget.scrollHeight - SCROLL_THRESHOLD_PX;
    if (reachedBottom) {
        loadMoreResults();
    }
}

export function setupGlobalEventListeners() {
    log.debug('Attaching global event listeners...');

    if (dom.newSearchButton) dom.newSearchButton.onclick = () => performNewSearch(dom.newSearchInput.value.trim());
    if (dom.newSearchInput) {
        dom.newSearchInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                performNewSearch(dom.newSearchInput.value.trim());
            }
        };
        dom.newSearchInput.oninput = () => toggleClearIcon(dom.newSearchInput, dom.mainSearchClear);
    }
    if (dom.mainSearchClear) {
        dom.mainSearchClear.onclick = () => {
            if(dom.newSearchInput) dom.newSearchInput.value = '';
            toggleClearIcon(dom.newSearchInput, dom.mainSearchClear);
            if(dom.newSearchInput) dom.newSearchInput.focus();
        };
    }

    if (dom.treeViewBtn) dom.treeViewBtn.onclick = switchToTreeView;
    if (dom.tableViewBtn) dom.tableViewBtn.onclick = switchToTableView;

    if (dom.treeContainer) {
        dom.treeContainer.removeEventListener('click', handleTreeArrowClick);
        dom.treeContainer.addEventListener('click', handleTreeArrowClick);
    }

    document.body.removeEventListener('click', handleSummarizeClick);
    document.body.addEventListener('click', handleSummarizeClick);

    setupFilterInputEventListeners();

    if (dom.scrollToTopButton) {
        dom.scrollToTopButton.onclick = () => {
            state.currentScrollTarget?.scrollTo({ top: 0, behavior: 'smooth' });
        };
    }

    const isTreeViewActive = dom.treeViewBtn && dom.treeViewBtn.classList.contains('active');
    const initialScrollTarget = isTreeViewActive
        ? document.querySelector('.container')
        : document.querySelector('.table-body-wrapper');
    if (initialScrollTarget) attachScrollListenerTo(initialScrollTarget);


    if (dom.openOptionsButton) {
        dom.openOptionsButton.onclick = () => {
            chrome.runtime.openOptionsPage ? chrome.runtime.openOptionsPage() : window.open(chrome.runtime.getURL('options/options.html'));
        };
    }

    setupModalResizers();

    toggleClearIcon(dom.textFilterInput, dom.filterTextClear);
    toggleClearIcon(dom.spaceFilterInput, dom.spaceClear);
    toggleClearIcon(dom.contributorFilterInput, dom.contributorClear);
    toggleClearIcon(dom.newSearchInput, dom.mainSearchClear);


    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'summariesCleared') {
            state.summaryCache.clear();
            document.querySelectorAll('.summarize-button').forEach(btn => {
                btn.textContent = '🧠 Summarize';
                btn.disabled = false;
                btn.classList.remove('loading');
            });
            log.info('[UI] Summary cache cleared and summarize buttons reset.');
        }
    });
}