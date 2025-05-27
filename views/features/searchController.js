// =========================================================
//                    SEARCH CONTROLLER
// =========================================================
import { dom } from '../domElements.js';
import * as state from '../state.js';
import { log } from '../config.js';
import { isValidInput, sanitizeInput, escapeHtml, updateUrlParams } from '../utils/generalUtils.js';
import { resetDataAndFetchResults } from '../core/dataProcessor.js';

export async function performNewSearch(query) {
    if (!query) {
        alert('Please enter a search query.');
        return;
    }
    if (!isValidInput(query)) {
        alert('Invalid search query.');
        return;
    }
    state.setSearchText(sanitizeInput(query));
    log.info(`[Search] Starting new search for: "${state.searchText}"`);
    document.title = `Search results for '${escapeHtml(state.searchText)}' on ${state.domainName}`;
    if (dom.pageTitle) dom.pageTitle.textContent = `Results (${state.domainName})`;
    chrome.storage.local.set({ lastSearchText: state.searchText });

    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set('searchText', state.searchText);
    newUrl.searchParams.set('baseUrl', state.baseUrl); // ensure baseUrl is also in URL if not already
    updateUrlParams(Object.fromEntries(newUrl.searchParams.entries())); // Use updated method

    resetDataAndFetchResults();
}