// =========================================================
//                    INITIALIZATION
// =========================================================
import { log, DB_VERSION, setResultsPerRequest as setGlobalResultsPerRequest } from './config.js';
import * as state from './state.js';
import { dom, cacheDomElements } from './domElements.js';
import { getQueryParams, sanitiseBaseUrl, escapeHtml } from './utils/generalUtils.js';
import { showLoadingIndicator, showNoResultsMessage } from './utils/uiUtils.js';
import { performNewSearch } from './features/searchController.js';
import { populateFiltersFromUrlParams } from './ui/filterControls.js';
import { setupGlobalEventListeners } from './eventManager.js';
import { updateTreeTooltipDisplayState } from './ui/treeView.js';
import { updateTableTooltipDisplayState } from './ui/tableView.js';
import { renderCurrentView } from './core/dataProcessor.js';

async function init() {
    log.info(`Initializing Enhanced Search Results page (DB_VERSION: ${DB_VERSION})...`);

    injectModalStyles();
    cacheDomElements();

    const params = getQueryParams();
    state.setSearchText((params.searchText || '').trim());
    state.setBaseUrl(sanitiseBaseUrl(params.baseUrl || window.location.origin));
    state.setDomainName(state.baseUrl ? new URL(state.baseUrl).hostname : 'Unknown');

    populateFiltersFromUrlParams(params);

    if (!state.searchText) log.warn('No searchText parameter received!');
    if (!state.baseUrl) {
        log.error('Invalid or missing baseUrl! Extension may not function correctly.');
        showLoadingIndicator(false);
        showNoResultsMessage();
        return;
    }

    document.title = `Search: '${escapeHtml(state.searchText)}' on ${state.domainName}`;
    if (dom.pageTitle) dom.pageTitle.textContent = `Results (${state.domainName})`;
    if (dom.newSearchInput) dom.newSearchInput.value = state.searchText;

    try {
        const data = await new Promise(res => chrome.storage.sync.get(['darkMode', 'resultsPerRequest', 'enableSummaries', 'openaiApiKey', 'showTooltips', 'showTableTooltips'], res));
        if (data.darkMode) {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }
        setGlobalResultsPerRequest(Number.isInteger(data.resultsPerRequest) ? data.resultsPerRequest : 75);
        state.setEnableSummaries(data.enableSummaries !== false);
        state.setTreeTooltipSettings({ showTreeTooltips: data.showTreeTooltips !== false });
        state.setTableTooltipSettings({ showTableTooltips: data.showTableTooltips !== false });
        log.debug('Settings loaded:', { perRequest: log.RESULTS_PER_REQUEST, summaries: state.ENABLE_SUMMARIES, tooltips: state.treeTooltipSettings.showTooltips });
    } catch (error) { log.error('Failed to load settings:', error); }

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        if (changes.darkMode) document.body.classList.toggle('dark-mode', changes.darkMode.newValue);
        if (changes.showTooltips) {
            state.setTreeTooltipSettings({ showTooltips: changes.showTooltips.newValue !== false });
            updateTreeTooltipDisplayState();
        }
        if (changes.showTableTooltips) {
            state.setTableTooltipSettings({ showTooltips: changes.showTableTooltips.newValue !== false });
            updateTableTooltipDisplayState();
        }
        if ('enableSummaries' in changes) {
            state.setEnableSummaries(changes.enableSummaries.newValue === true);
            renderCurrentView();
        }
    });

    setupGlobalEventListeners();

    if (dom.treeContainer) dom.treeContainer.style.display = 'block';
    if (dom.tableContainer) dom.tableContainer.style.display = 'none';
    if (dom.treeViewBtn) dom.treeViewBtn.classList.add('active');


    if (state.searchText && state.baseUrl) {
        performNewSearch(state.searchText);
    } else {
        showNoResultsMessage();
        showLoadingIndicator(false);
    }
    updateTreeTooltipDisplayState();
    updateTableTooltipDisplayState();

    window.addEventListener('popstate', () => {
        const params = getQueryParams();
        state.setSearchText((params.searchText || '').trim());
        state.setBaseUrl(sanitiseBaseUrl(params.baseUrl || window.location.origin));
        state.setDomainName(state.baseUrl ? new URL(state.baseUrl).hostname : 'Unknown');

        populateFiltersFromUrlParams(params);

        if (state.searchText && state.baseUrl) {
            performNewSearch(state.searchText);
        } else {
            showNoResultsMessage();
            showLoadingIndicator(false);
        }
    });

    log.info('Initialization complete.');
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    init().catch(err => {
        log.error('Initialization failed:', err);
        showLoadingIndicator(false);
        const body = document.querySelector('body');
        if (body) {
            body.innerHTML = '<p style="color: red; text-align: center; margin-top: 50px;">An error occurred during initialization. Please check the console.</p>';
        }
    });
});

function injectModalStyles() {
    const existing = document.getElementById('embedded-ai-modal-style');
    if (existing) return;

    const link = document.createElement('link');
    link.id = 'embedded-ai-modal-style';
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('content/modalStyles.css');
    document.head.appendChild(link);
}