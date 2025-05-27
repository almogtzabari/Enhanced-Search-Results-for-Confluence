// =========================================================
//                    DATA PROCESSING (Filter, Sort)
// =========================================================
import { dom } from '../domElements.js';
import * as state from '../state.js';
import { log, typeLabels } from '../config.js';
import { updateUrlParams } from '../utils/generalUtils.js';
import { showNoResultsMessage } from '../utils/uiUtils.js';
import { loadMoreResults } from './dataFetcher.js';
import { updateTableHtml } from '../ui/tableView.js';
import { updateTreeHtml } from '../ui/treeView.js';


export function resetDataAndFetchResults() {
    log.debug('[Search] Resetting data and fetching fresh results');
    const encodeLabel = (input) => {
        const key = input.dataset.key || '';
        const val = input.value?.trim() || '';
        return key ? `${key}:${val}` : '';
    };
    updateUrlParams({
        searchText: state.searchText,
        baseUrl: state.baseUrl,
        text: dom.textFilterInput.value.trim(),
        space: encodeLabel(dom.spaceFilterInput),
        contributor: encodeLabel(dom.contributorFilterInput),
        date: dom.dateFilter.value,
        type: dom.typeFilter.value
    });
    state.setNodeMap({});
    state.setRoots([]);
    state.setSearchResultIds(new Set());
    state.setAllExpanded(true);
    state.setLoading(false);
    state.setAllResultsLoaded(false);
    state.setIsFetching(false);
    state.setStart(0);
    state.setTotalSize(null);
    state.setAllResults([]);
    state.setFilteredResults([]);
    state.setFullSpaceList([]);
    state.setFullContributorList([]);
    state.setCurrentSortColumn('');
    state.setCurrentSortOrder('');
    if(dom.treeContainer) dom.treeContainer.innerHTML = '';
    if(dom.tableContainer) dom.tableContainer.innerHTML = '';
    if(dom.spaceOptionsContainer) dom.spaceOptionsContainer.innerHTML = '';
    if(dom.contributorOptionsContainer) dom.contributorOptionsContainer.innerHTML = '';
    loadMoreResults();
}


export function processAndRenderResults(force = false) {
    const textValue = dom.textFilterInput.value.toLowerCase();
    const spaceKey = dom.spaceFilterInput.dataset.key || '';
    const contributorKey = dom.contributorFilterInput.dataset.key || '';
    if (!force && textValue === state.lastTextFilter && spaceKey === state.lastSpaceKey && contributorKey === state.lastContributorKey) return;
    log.debug('[Filter] Filtering results...', { textValue, spaceKey, contributorKey });
    state.setLastTextFilter(textValue);
    state.setLastSpaceKey(spaceKey);
    state.setLastContributorKey(contributorKey);

    state.setFilteredResults(state.allResults.filter(page => {
        const matchesText = !textValue || page.title.toLowerCase().includes(textValue);
        const matchesSpace = !spaceKey || page.space?.key === spaceKey;
        const creator = page.history?.createdBy;
        const matchesContributor = !contributorKey || (creator && (creator.username === contributorKey || creator.userKey === contributorKey || creator.accountId === contributorKey));
        return matchesText && matchesSpace && matchesContributor;
    }));

    if (state.currentSortColumn && state.currentSortOrder) {
        sortFilteredResults(state.currentSortColumn, state.currentSortOrder);
    } else {
        renderCurrentView();
    }
}

export function sortFilteredResults(column, order) {
    log.debug('[Sort] Sorting results...', { column, order });
    state.filteredResults.sort((a, b) => {
        let valA, valB;
        switch (column) {
            case 'Type': valA = typeLabels[a.type] || ''; valB = typeLabels[b.type] || ''; break;
            case 'Name': valA = a.title.toLowerCase(); valB = b.title.toLowerCase(); break;
            case 'Space': valA = a.space?.name.toLowerCase() || ''; valB = b.space?.name.toLowerCase() || ''; break;
            case 'Contributor': valA = a.history?.createdBy?.displayName.toLowerCase() || ''; valB = b.history?.createdBy?.displayName.toLowerCase() || ''; break;
            case 'Date Created': valA = new Date(a.history?.createdDate || 0); valB = new Date(b.history?.createdDate || 0); break;
            case 'Last Modified': valA = new Date(a.version?.when || 0); valB = new Date(b.version?.when || 0); break;
            default: return 0;
        }
        if (valA < valB) return order === 'asc' ? -1 : 1;
        if (valA > valB) return order === 'asc' ? 1 : -1;
        return 0;
    });
    renderCurrentView();
}

export function renderCurrentView() {
    if (state.filteredResults.length === 0 && state.allResultsLoaded && state.allResults.length > 0) {
        showNoResultsMessage();
    } else {
        const prevScrollTopTable = document.querySelector('.table-body-wrapper')?.scrollTop || 0;
        const prevScrollTopTree = dom.treeContainer?.scrollTop || 0;

        updateTableHtml(state.filteredResults);
        updateTreeHtml(state.filteredResults);

        const tableBodyWrapper = document.querySelector('.table-body-wrapper');
        if (tableBodyWrapper) {
            tableBodyWrapper.scrollTop = prevScrollTopTable;
        }
         if (dom.treeContainer && dom.treeViewBtn.classList.contains('active')) {
            dom.treeContainer.scrollTop = prevScrollTopTree;
        }
    }
}