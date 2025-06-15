// =========================================================
//                    INITIALIZATION
// =========================================================
import { log, DB_VERSION, setResultsPerRequest as setGlobalResultsPerRequest } from './config.js';
import * as state from './state.js';
import { dom, cacheDomElements } from './domElements.js';
import { getQueryParams, sanitiseBaseUrl, escapeHtml } from './utils/generalUtils.js';
import { showLoadingIndicator, showNoResultsMessage, toggleClearIcon } from './utils/uiUtils.js';
import { performNewSearch } from './features/searchController.js';
import { populateFiltersFromUrlParams } from './ui/filterControls.js';
import { setupGlobalEventListeners } from './eventManager.js';
import { updateTreeTooltipDisplayState } from './ui/treeView.js';
import { updateTableTooltipDisplayState } from './ui/tableView.js';
import { renderCurrentView, resetDataAndFetchResults } from './core/dataProcessor.js';
import { getAllSavedSearches, storeSavedSearch, deleteSavedSearch, clearAllSavedSearches } from './services/dbService.js';
import { showInputDialog, showConfirmationDialog } from './ui/modalManager.js';

const $ = id => document.getElementById(id);
let originalSavedSearchList = [];

function filterSavedSearches(query) {
    const q = query.toLowerCase().trim();
    return originalSavedSearchList.filter(entry => {
        const inName = entry.name.toLowerCase().includes(q);
        const inSearchText = entry.searchText.toLowerCase().includes(q);
        const { text, space, contributor, type, date } = entry.filters;
        const inFilters =
            (text?.label || text?.key || '').toLowerCase().includes(q) ||
            (space?.label || space?.key || '').toLowerCase().includes(q) ||
            (contributor?.label || contributor?.key || '').toLowerCase().includes(q) ||
            (type || '').toLowerCase().includes(q) ||
            (date || '').toLowerCase().includes(q);
        return inName || inSearchText || inFilters;
    });
}

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
    if (dom.pageTitle) dom.pageTitle.textContent = `${state.domainName}`;
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

    $('save-search-button').onclick = () => {
        showInputDialog('<h2>Name this search</h2>', 'e.g., My Important Docs (leave empty to auto-name)', (nameInput) => {
            let name = nameInput.trim();
            if (!name) {
                const date = new Date();
                name = `Search on ${date.toLocaleDateString()} at ${date.toLocaleTimeString()}`;
                const baseName = name;
                let counter = 1;
                const existingNames = new Set(originalSavedSearchList.map(e => e.name));
                while (existingNames.has(name)) {
                    name = `${baseName} (${counter++})`;
                }
            }

            const filters = {
                text: {
                    key: dom.textFilterInput.value.trim(),
                    label: dom.textFilterInput.value.trim()
                },
                space: {
                    key: dom.spaceFilterInput.dataset.key || '',
                    label: dom.spaceFilterInput.value.trim() || ''
                },
                contributor: {
                    key: dom.contributorFilterInput.dataset.key || '',
                    label: dom.contributorFilterInput.value.trim() || ''
                },
                date: dom.dateFilter.value,
                type: dom.typeFilter.value
            };

            const entry = {
                id: Date.now().toString(),
                name,
                searchText: state.searchText,
                baseUrl: state.baseUrl,
                filters,
                createdAt: Date.now()
            };

            storeSavedSearch(entry).then(() => {
                originalSavedSearchList.push(entry);
                const filterInput = $('saved-searches-filter-input');
                if (filterInput) filterInput.value = '';
                renderSavedSearchList(originalSavedSearchList);

                const status = document.createElement('div');
                status.textContent = '✅ Search saved.';
                status.style.cssText = 'text-align:center; margin-top: 10px; color: green; font-weight: bold;';
                document.body.appendChild(status);
                setTimeout(() => status.remove(), 2000);
            });
        });
    };

    $('show-saved-searches').onclick = () => {
        getAllSavedSearches().then(showSavedSearchesModal);
    };

    $('saved-searches-close').onclick = () => {
        $('saved-searches-modal').style.display = 'none';
    };

    $('saved-searches-modal').addEventListener('click', (e) => {
        if (e.target.id === 'saved-searches-modal') {
            e.currentTarget.style.display = 'none';
        }
    });

    $('clear-saved-searches').onclick = () => {
        showConfirmationDialog('<h2>Clear all saved searches?</h2>This cannot be undone.', () => {
            clearAllSavedSearches().then(() => {
                originalSavedSearchList = [];
                renderSavedSearchList(originalSavedSearchList);
            });
        });
    };

    function showSavedSearchesModal(list) {
        // Always refresh the canonical list
        originalSavedSearchList = list;

        // Avoid injecting multiple filters
        const input = document.getElementById('saved-searches-filter-input');
        if (input) {
            const handleFilterInput = (e) => {
                const query = e.target.value.toLowerCase().trim();
                renderSavedSearchList(filterSavedSearches(query));
            };

            input.removeEventListener('input', handleFilterInput); // avoid duplication
            input.addEventListener('input', handleFilterInput);
        }

        // Show modal
        const modal = $('saved-searches-modal');
        modal.style.display = 'flex';

        setTimeout(() => {
            const input = $('saved-searches-filter-input');
            if (input) input.focus();
        }, 0);

        document.addEventListener('keydown', function handleEscapeKey(e) {
            if (e.key === 'Escape') {
                modal.style.display = 'none';
                document.removeEventListener('keydown', handleEscapeKey);
            }
        }, { once: true });

        renderSavedSearchList(list);
    }

    // Setup logo as reset link
    const logoAnchor = document.getElementById('logo-link');
    if (logoAnchor && state.baseUrl) {
        const cleanUrl = chrome.runtime.getURL('views/index.html') + `?baseUrl=${encodeURIComponent(state.baseUrl)}`;
        logoAnchor.href = cleanUrl;
        logoAnchor.title = 'Click to reset search and filters';
    }

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
    const existing = $('embedded-ai-modal-style');
    if (existing) return;

    const link = document.createElement('link');
    link.id = 'embedded-ai-modal-style';
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('content/modalStyles.css');
    document.head.appendChild(link);
}

function setInputAndToggle(input, clearBtn, value, datasetKey) {
    input.value = value || '';
    if (datasetKey !== undefined) input.dataset.key = datasetKey;
    toggleClearIcon(input, clearBtn);
}

function renderSavedSearchList(list) {
    const container = $('saved-searches-list');
    container.innerHTML = '';

    if (!list.length) {
        container.innerHTML = '<p>No saved searches.</p>';
        return;
    }

    list.sort((a, b) => b.createdAt - a.createdAt);
    for (const entry of list) {
        const div = document.createElement('div');
        div.className = 'saved-search-entry';
        div.innerHTML = `
            <strong>${entry.name}</strong><br>
            <span style="display:block; margin: 2px 0;">
                🔍 <b>Search:</b> <code>${entry.searchText}</code>
            </span>
            ${entry.filters.text?.key ? `<span>🔠 <b>Text:</b> ${entry.filters.text.label || entry.filters.text.key}</span><br>` : ''}
            ${entry.filters.space?.key ? `<span>🚀 <b>Space:</b> ${entry.filters.space.label || entry.filters.space.key}</span><br>` : ''}
            ${entry.filters.contributor?.key ? `<span>👤 <b>Contributor:</b> ${entry.filters.contributor.label || entry.filters.contributor.key}</span><br>` : ''}
            ${entry.filters.date && entry.filters.date !== 'any' ? `<span>🕒 <b>Date:</b> ${entry.filters.date}</span><br>` : ''}
            ${entry.filters.type ? `<span>📄 <b>Type:</b> ${entry.filters.type}</span><br>` : ''}
            <div style="margin-top: 6px;">
                <button data-id="${entry.id}" class="run-saved">🔍 Run</button>
                <button data-id="${entry.id}" class="rename-saved">✏️ Rename</button>
                <button data-id="${entry.id}" class="del-saved">❌ Delete</button>
            </div>
        `;
        container.appendChild(div);
    }

    container.querySelectorAll('.run-saved').forEach(btn => {
        btn.onclick = () => {
            const entry = originalSavedSearchList.find(e => e.id === btn.dataset.id);
            if (!entry) return;

            state.setSearchText(entry.searchText);
            state.setBaseUrl(entry.baseUrl);
            dom.newSearchInput.value = entry.searchText;

            setInputAndToggle(
                dom.textFilterInput,
                dom.filterTextClear,
                entry.filters.text?.label || entry.filters.text?.key
            );

            setInputAndToggle(
                dom.spaceFilterInput,
                dom.spaceClear,
                entry.filters.space?.label || entry.filters.space?.key,
                entry.filters.space?.key
            );

            setInputAndToggle(
                dom.contributorFilterInput,
                dom.contributorClear,
                entry.filters.contributor?.label || entry.filters.contributor?.key,
                entry.filters.contributor?.key
            );

            // Date & type
            dom.dateFilter.value = entry.filters.date || '';
            dom.typeFilter.value = entry.filters.type || '';

            // URL and trigger new search
            const url = new URL(window.location.href);
            url.searchParams.set('searchText', state.searchText);
            url.searchParams.set('baseUrl', state.baseUrl);
            url.searchParams.set('text', entry.filters.text?.key || '');
            url.searchParams.set('space', entry.filters.space?.key || '');
            url.searchParams.set('contributor', entry.filters.contributor?.key || '');
            url.searchParams.set('date', entry.filters.date || '');
            url.searchParams.set('type', entry.filters.type || '');

            history.pushState(null, '', url.toString());
            $('saved-searches-modal').style.display = 'none';
            resetDataAndFetchResults();
        };
    });

    container.querySelectorAll('.del-saved').forEach(btn => {
        btn.onclick = () => {
            showConfirmationDialog('<h2>Delete this saved search?</h2>This cannot be undone.', () => {
                deleteSavedSearch(btn.dataset.id).then(() => {
                    originalSavedSearchList = originalSavedSearchList.filter(e => e.id !== btn.dataset.id);
                    const filterInput = $('saved-searches-filter-input');
                    const query = filterInput?.value?.toLowerCase().trim() || '';
                    renderSavedSearchList(filterSavedSearches(query));
                });
            });
        };
    });

    container.querySelectorAll('.rename-saved').forEach(btn => {
        btn.onclick = () => {
            const entry = list.find(e => e.id === btn.dataset.id);
            if (!entry) return;
            showInputDialog('<h2>Rename this search</h2>', 'Enter new name', (newName) => {
                entry.name = newName;
                storeSavedSearch(entry).then(() => {
                    const filterInput = document.getElementById('saved-searches-filter-input');
                    const query = filterInput?.value?.toLowerCase().trim() || '';
                    renderSavedSearchList(filterSavedSearches(query));
                });
            });
        };
    });
}