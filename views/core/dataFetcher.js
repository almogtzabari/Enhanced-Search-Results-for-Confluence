// =========================================================
//                    DATA FETCHING
// =========================================================
import { dom } from '../domElements.js';
import * as state from '../state.js';
import { log, RESULTS_PER_REQUEST } from '../config.js';
import { showLoadingIndicator, showNoResultsMessage } from '../utils/uiUtils.js';
import { getStoredSummary } from '../services/dbService.js';
import { processAndRenderResults, renderCurrentView } from './dataProcessor.js';
import { updateFilterOptionsUIDisplay } from '../ui/filterControls.js';
import { attachScrollListenerTo } from '../eventManager.js';


export function buildCQL() {
    const cqlParts = [];
    const escapedSearchText = state.searchText.replace(/(["\\])/g, '\\$1');
    cqlParts.push(`(text ~ "${escapedSearchText}" OR title ~ "${escapedSearchText}")`);
    const spaceKey = dom.spaceFilterInput.dataset.key || '';
    const contributorKey = dom.contributorFilterInput.dataset.key || '';
    if (spaceKey) cqlParts.push(`space="${spaceKey}"`);
    if (contributorKey) cqlParts.push(`creator="${contributorKey}"`);
    const dateVal = dom.dateFilter.value;
    const typeVal = dom.typeFilter.value;
    const today = new Date();
    let fromDate = null;
    switch (dateVal) {
        case '1d': fromDate = new Date(new Date().setDate(today.getDate() - 1)); break;
        case '1w': fromDate = new Date(new Date().setDate(today.getDate() - 7)); break;
        case '1m': fromDate = new Date(new Date().setMonth(today.getMonth() - 1)); break;
        case '1y': fromDate = new Date(new Date().setFullYear(today.getFullYear() - 1)); break;
    }
    if (fromDate) cqlParts.push(`lastModified >= "${fromDate.toISOString().split('T')[0]}"`);
    if (typeVal) cqlParts.push(`type="${typeVal}"`);
    const finalCQL = cqlParts.join(' AND ');
    log.debug('[CQL] Built:', finalCQL);
    return encodeURIComponent(finalCQL);
}

export async function loadMoreResults() {
    if (state.loading || state.allResultsLoaded || state.isFetching) return;
    state.setIsFetching(true);
    log.debug('[Search] Loading more results...');
    showLoadingIndicator(true);
    const cql = buildCQL();
    const searchUrl = `${state.baseUrl}/rest/api/content/search?cql=${cql}&limit=${RESULTS_PER_REQUEST}&start=${state.start}&expand=ancestors,space.icon,history.createdBy,version`;
    try {
        const response = await fetch(searchUrl, { method: 'GET', headers: { 'Accept': 'application/json' }, credentials: 'include' });
        if (!response.ok) throw new Error(`Workspace error: ${response.statusText}`);
        const searchData = await response.json();
        if (state.totalSize === null) state.setTotalSize(searchData.totalSize);
        const results = searchData.results || [];
        if (results.length === 0) {
            state.setAllResultsLoaded(true);
            if (state.allResults.length === 0) showNoResultsMessage();
        } else {
            state.setStart(state.start + results.length);
            log.debug(`[Search] Fetched ${results.length} results. Total: ${state.start} of ${state.totalSize || '?'}`);
            results.forEach(pageData => {
                if (!state.searchResultIds.has(pageData.id)) {
                    state.searchResultIds.add(pageData.id);
                    state.allResults.push(pageData);
                    getStoredSummary(pageData.id, state.baseUrl).then(entry => {
                        if (entry?.summaryHtml) {
                            state.summaryCache.set(pageData.id, entry.summaryHtml);
                            renderCurrentView(); // Use renderCurrentView from dataProcessor
                        }
                    }).catch(e => log.warn('Error preloading summary:', e));
                }
            });
            updateFilterOptionsUIDisplay();
            processAndRenderResults(true);
            if (state.start >= state.totalSize) state.setAllResultsLoaded(true);
        }
    } catch (err) {
        log.error('[Search] Failed to fetch results:', err);
        alert(`An error occurred: ${err.message}`);
        state.setAllResultsLoaded(true);
    } finally {
        showLoadingIndicator(false);
        state.setLoading(false);
        state.setIsFetching(false);

        if (!state.allResultsLoaded && state.currentScrollTarget) {
            attachScrollListenerTo(state.currentScrollTarget);
            requestAnimationFrame(() => {
                if (state.currentScrollTarget) state.currentScrollTarget.scrollTop -= 1;
            });
        }
    }
}