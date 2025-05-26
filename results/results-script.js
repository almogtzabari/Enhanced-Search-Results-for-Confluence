/**
 * results-script.js
 *
 * Powers the enhanced search results page for the "Enhanced Search Results for Confluence"
 * browser extension. Handles fetching, display, filtering, sorting, AI summarization,
 * and user interactions.
 *
 * Version 3: Addresses IndexedDB store creation, Tree View population,
 * 3-state sorting, and filter clear icon visibility.
 */
document.addEventListener('DOMContentLoaded', () => {

    // =========================================================
    //                    CONSTANTS & GLOBALS
    // =========================================================

    // --- Configuration ---
    const DEBUG = false; // Toggle verbose DEBUG logging
    const USE_LOCAL_PROXY = false; // Use local proxy for OpenAI requests
    const DB_NAME = 'ConfluenceSummariesDB';
    const DB_VERSION = 3; // << INCREMENTED DB VERSION to fix store creation issues
    const SUMMARY_STORE_NAME = 'summaries';
    const CONVERSATION_STORE_NAME = 'conversations';
    const SCROLL_THRESHOLD_PX = 5;
    let RESULTS_PER_REQUEST = 75;

    // --- Type Definitions ---
    const typeIcons = { page: '📘', blogpost: '📝', attachment: '📎', comment: '💬' };
    const typeLabels = { page: 'Page', blogpost: 'Blog Post', attachment: 'Attachment', comment: 'Comment' };
    const DEFAULT_COL_WIDTHS = [80, 320, 200, 160, 100, 100];

    // --- AI Prompts ---
    const summarySystemPrompt = `
        You are a technical summarizer. Your task is to generate a concise, relevance-focused HTML summary of Confluence content. This will help users assess whether a document is worth opening.

        You are given:
        - Title
        - Raw HTML body (Confluence storage format)
        - Type: "page", "blogpost", "comment", or "attachment"
        - Space name (if available)
        - Parent title (if comment)
        - Optional user prompt (important!)

        Output only valid, clean and nicely formatted HTML (no Markdown or code blocks, and no \`\`\`html). Use this format (unless user prompt requests otherwise):

        1. <h3> What is this [content type] about?</h3> followed by a paragraph summarizing content, with context:
        - Page: "This page, from the [space_link] space, covers..."
        - Blog post: "...published in the [space_link] space..."
        - Comment: "...posted on the page titled _X_ in the [space_link] space..."
        - Attachment: "...uploaded to the [space_link] space..."
        Use [space_link] as: <b><a href='[space_url]' target='_blank'>[space]</a></b> if space_url is available, or <b>[space]</b> otherwise.
        For example, "This page, from the <b><a href="[space_url]">[space]</a></b> space, covers...".
        2. <h3> Main points</h3> followed by a <ul><li> list
        3. Keep tone concise, neutral, and useful. Avoid repeating title. Omit internal field names or Confluence-specific terms.

        Important: If a user prompt is provided, it must be addressed in the summary. Use it to focus the summary on what the user cares about.
    `;

    const qaSystemPrompt = `
        You are a helpful AI assistant answering follow-up questions about a Confluence document and its summary.
        Respond clearly, accurately, and in plain text. Avoid reiterating the full summary format.
        Answer as a helpful peer who understands the document’s purpose and key details.
        Important: Output only valid, clean and nicely formatted HTML (no Markdown or code blocks, and no \`\`\`html)
    `;

    // --- Global State ---
    let searchText = '', baseUrl = '', domainName = '';
    let nodeMap = {}, roots = [], searchResultIds = new Set();
    let allExpanded = true, collapsedNodes = new Set();
    let loading = false, isFetching = false, allResultsLoaded = false;
    let start = 0, totalSize = null;
    let allResults = [], filteredResults = [];
    let fullSpaceList = [], fullContributorList = [];
    const conversationHistories = new Map();
    let currentSortColumn = '', currentSortOrder = '';
    let tooltipSettings = { showTooltips: true };
    const confluenceBodyCache = new Map(), summaryCache = new Map();
    const tooltipBoundNodes = new WeakMap();
    let lastTextFilter = '', lastSpaceKey = '', lastContributorKey = '';
    let colWidths = [...DEFAULT_COL_WIDTHS];
    let currentScrollTarget = null;

    // --- DOM Elements (Cached) ---
    const treeContainer = document.getElementById('tree-container');
    const tableContainer = document.getElementById('table-container');
    const spaceOptionsContainer = document.getElementById('space-options');
    const contributorOptionsContainer = document.getElementById('contributor-options');
    const spaceFilterInput = document.getElementById('space-filter');
    const contributorFilterInput = document.getElementById('contributor-filter');
    const textFilterInput = document.getElementById('text-filter');
    const dateFilter = document.getElementById('date-filter');
    const typeFilter = document.getElementById('type-filter');
    const newSearchInput = document.getElementById('new-search-input');
    const newSearchButton = document.getElementById('new-search-button');
    const mainSearchClear = document.getElementById('main-search-clear');
    const scrollToTopButton = document.getElementById('scroll-to-top');
    const summaryModal = document.getElementById('summary-modal');
    const resizableModal = document.getElementById('resizable-modal');

    // --- Logging Utility ---
    const log = {
        debug: (...args) => DEBUG && console.debug('[DEBUG]', ...args),
        info: (...args) => console.info('[INFO]', ...args),
        warn: (...args) => console.warn('[WARN]', ...args),
        error: (...args) => console.error('[ERROR]', ...args),
    };

    // =========================================================
    //                    UTILITY FUNCTIONS
    // =========================================================
    function triggerPoofEffect() {
        const audio = document.getElementById('poof-audio');
        if (audio) {
            audio.currentTime = 0;
            audio.play().catch(e => log.warn('Poof sound error:', e));
        }
    }
    function debounce(fn, delay) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn(...args), delay);
        };
    }
    function getQueryParams() {
        const params = {};
        const sp = new URLSearchParams(window.location.search);
        for (const [key, value] of sp.entries()) params[key] = value;
        log.debug('[Query] Params:', params);
        return params;
    }
    function updateUrlParams(params) {
        const url = new URL(window.location.href);
        for (const key in params) {
            if (params[key]) url.searchParams.set(key, params[key]);
            else url.searchParams.delete(key);
        }
        history.replaceState(null, '', url.toString());
    }
    function populateFiltersFromUrlParams(params) {
        textFilterInput.value = params.text || '';
        const [spaceKey, spaceLabel] = (params.space || '').split(':');
        spaceFilterInput.dataset.key = spaceKey || '';
        spaceFilterInput.value = spaceLabel || spaceKey || '';

        const [contribKey, contribLabel] = (params.contributor || '').split(':');
        contributorFilterInput.dataset.key = contribKey || '';
        contributorFilterInput.value = contribLabel || contribKey || '';
        dateFilter.value = params.date || 'any';
        typeFilter.value = params.type || '';

        // Update UI clear icons for filters
        toggleClearIcon(textFilterInput, document.getElementById('filter-text-clear'));
        toggleClearIcon(spaceFilterInput, document.getElementById('space-clear'));
        toggleClearIcon(contributorFilterInput, document.getElementById('contributor-clear'));
    }
    function escapeHtml(text = '') {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#039;' };
        return text.replace(/[&<>"']/g, m => map[m]);
    }
    function isValidInput(input) {
        const regex = /^[\p{L}\p{N}\s\-_.@"']*$/u;
        return regex.test(input);
    }
    function sanitizeInput(input) { return input.replace(/[^\p{L}\p{N}\s\-_.@"']/gu, ''); }
    function formatDate(dateString) {
        const date = new Date(dateString);
        const pad = n => String(n).padStart(2, '0');
        return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} at ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
    function sanitiseBaseUrl(raw) {
        try {
            const u = new URL(raw);
            if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Invalid protocol');
            return u.origin;
        }
        catch (_) {
            log.error('Rejected baseUrl:', raw);
            return '';
        }
    }
    function buildConfluenceUrl(path) {
        if (typeof path !== 'string' || path.startsWith('http:') || path.startsWith('https:') || path.includes('javascript:') || path.includes('data:')) return '#';
        try { return new URL(path, baseUrl).toString(); } catch (_) { return '#'; }
    }
    function detectDirection(text = '') {
        const rtlChars = /[\u0590-\u05FF\u0600-\u06FF]/;
        return rtlChars.test(text) ? 'rtl' : 'ltr';
    }
    function sanitizeHtmlWithDOM(htmlString = '') {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'text/html');
        ['script', 'style', 'iframe'].forEach(tag => doc.querySelectorAll(tag).forEach(el => el.remove()));
        const walker = document.createTreeWalker(doc, NodeFilter.SHOW_COMMENT, null);
        let comment;
        while ((comment = walker.nextNode())) comment.parentNode.removeChild(comment);
        return doc.body.innerHTML;
    }
    function toggleClearIcon(inputElem, clearIcon) { clearIcon.style.display = inputElem.value.trim() ? 'inline' : 'none'; } // Using trim for accuracy
    function showLoadingIndicator(show) {
        const overlay = document.getElementById('global-loading-overlay');
        if (overlay) overlay.style.display = show ? 'flex' : 'none';
    }
    function showNoResultsMessage() {
        const message = '<p>No results found.</p>';
        treeContainer.innerHTML = message;
        tableContainer.innerHTML = message;
    }

    // =========================================================
    //                    IndexedDB FUNCTIONS
    // =========================================================
    function openDb() {
        log.debug(`[DB] Attempting to open DB: ${DB_NAME}, Version: ${DB_VERSION}`);
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = (event) => {
                log.error('[DB] Open error:', event.target.error);
                reject(event.target.error);
            };
            request.onsuccess = (event) => {
                log.info('[DB] Connection opened successfully.', { version: event.target.result.version });
                resolve(event.target.result);
            };
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                log.info(`[DB] Upgrade needed from v${event.oldVersion} to v${DB_VERSION}. Current stores:`, Array.from(db.objectStoreNames));
                if (!db.objectStoreNames.contains(SUMMARY_STORE_NAME)) {
                    log.info(`[DB] Creating object store: ${SUMMARY_STORE_NAME}`);
                    db.createObjectStore(SUMMARY_STORE_NAME, { keyPath: ['contentId', 'baseUrl'] });
                } else {
                    log.info(`[DB] Object store already exists: ${SUMMARY_STORE_NAME}`);
                }
                if (!db.objectStoreNames.contains(CONVERSATION_STORE_NAME)) {
                    log.info(`[DB] Creating object store: ${CONVERSATION_STORE_NAME}`);
                    db.createObjectStore(CONVERSATION_STORE_NAME, { keyPath: ['contentId', 'baseUrl'] });
                } else {
                    log.info(`[DB] Object store already exists: ${CONVERSATION_STORE_NAME}`);
                }
                log.info('[DB] Upgrade complete. Stores after upgrade:', Array.from(db.objectStoreNames));
            };
        });
    }
    async function makeDbRequest(storeName, mode, operation, data = null) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            try {
                if (!db.objectStoreNames.contains(storeName)) {
                    log.error(`[DB] Store not found for transaction: ${storeName}. Available stores:`, Array.from(db.objectStoreNames));
                    reject(new DOMException(`Object store ${storeName} not found`, 'NotFoundError'));
                    return;
                }
                const tx = db.transaction(storeName, mode);
                const store = tx.objectStore(storeName);
                const request = data !== null ? store[operation](data) : store[operation](); // Handle operations like clear()
                request.onsuccess = () => resolve(request.result);
                request.onerror = (event) => {
                    log.error(`[DB] ${operation} error on ${storeName}`, event.target.error);
                    reject(event.target.error);
                };
            } catch (error) {
                log.error(`[DB] Transaction creation error on ${storeName}`, error);
                reject(error);
            }
        });
    }
    async function getStoredSummary(contentId, baseUrl) {
        log.debug('[DB] Fetching stored summary', { contentId, baseUrl });
        try { return await makeDbRequest(SUMMARY_STORE_NAME, 'readonly', 'get', [contentId, baseUrl]); }
        catch (e) {
            log.warn('[DB] Failed to get stored summary', e);
            return null;
        }
    }
    async function storeSummary({ contentId, baseUrl, title, summaryHtml, bodyHtml }) {
        const entry = { contentId, baseUrl, title, summaryHtml, bodyHtml, timestamp: Date.now() };
        log.debug('[DB] Storing summary', { contentId, baseUrl });
        try { await makeDbRequest(SUMMARY_STORE_NAME, 'readwrite', 'put', entry); }
        catch (e) { log.error('[DB] Failed to store summary', e); }
    }
    async function getStoredConversation(contentId, baseUrl) {
        log.debug('[DB] Fetching stored conversation', { contentId, baseUrl });
        try { return await makeDbRequest(CONVERSATION_STORE_NAME, 'readonly', 'get', [contentId, baseUrl]); }
        catch (e) {
            log.warn('[DB] Failed to get stored conversation', e);
            return null;
        }
    }
    async function storeConversation(contentId, baseUrl, messages) {
        const entry = { contentId, baseUrl, messages, timestamp: Date.now() };
        log.debug('[DB] Storing conversation', { contentId, baseUrl, count: messages.length });
        try { await makeDbRequest(CONVERSATION_STORE_NAME, 'readwrite', 'put', entry); }
        catch (e) { log.error('[DB] Failed to store conversation', e); }
    }

    // =========================================================
    //                      API FUNCTIONS
    // =========================================================
    async function fetchConfluenceBodyById(contentId) {
        if (confluenceBodyCache.has(contentId)) {
            log.debug(`[Cache] Returning body for ${contentId}`);
            return confluenceBodyCache.get(contentId);
        }
        const apiUrl = `${baseUrl}/rest/api/content/${contentId}?expand=body.storage`;
        try {
            const response = await fetch(apiUrl, { method: 'GET', headers: { 'Accept': 'application/json' }, credentials: 'include' });
            if (!response.ok) throw new Error(`Workspace failed: ${response.statusText}`);
            const data = await response.json();
            const bodyHtml = data.body?.storage?.value || '(No content)';
            confluenceBodyCache.set(contentId, bodyHtml);
            log.debug(`[Cache] Fetched body for ${contentId}`);
            return bodyHtml;
        } catch (error) {
            log.error('[API] Error in fetchConfluenceBodyById:', error);
            throw error;
        }
    }
    async function sendOpenAIRequest({ apiKey, apiUrl, model, messages }) {
        log.info('[OpenAI] → POST', apiUrl);
        log.debug('[OpenAI] Payload:', { model, msgCount: messages.length });
        const useProxy = USE_LOCAL_PROXY;
        const url = useProxy ? 'http://localhost:3000/proxy' : apiUrl;
        const body = useProxy ? JSON.stringify({ apiKey, apiUrl, model, messages }) : JSON.stringify({ model, messages });
        const headers = useProxy ? { 'Content-Type': 'application/json' } : { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
        try {
            const response = await fetch(url, { method: 'POST', headers, body });
            if (!response.ok) {
                const errorText = await response.text();
                log.error('[OpenAI] HTTP Error', response.status, errorText.slice(0, 200));
                throw new Error(`OpenAI request failed: ${response.statusText}`);
            }
            const result = await response.json();
            log.info('[OpenAI] ✓ Response OK');
            log.debug('[OpenAI] Meta:', { model: result.model, usage: result.usage });
            return result;
        } catch (error) {
            log.error('[OpenAI] Fetch/Request Error:', error);
            throw error;
        }
    }

    // =========================================================
    //                    CORE LOGIC FUNCTIONS
    // =========================================================
    function buildCQL() {
        const cqlParts = [];
        const escapedSearchText = searchText.replace(/(["\\])/g, '\\$1');
        cqlParts.push(`(text ~ "${escapedSearchText}" OR title ~ "${escapedSearchText}")`);
        const spaceKey = spaceFilterInput.dataset.key || '';
        const contributorKey = contributorFilterInput.dataset.key || '';
        if (spaceKey) cqlParts.push(`space="${spaceKey}"`);
        if (contributorKey) cqlParts.push(`creator="${contributorKey}"`);
        const dateVal = dateFilter.value;
        const typeVal = typeFilter.value;
        const today = new Date();
        let fromDate = null;
        switch (dateVal) {
            case '1d': fromDate = new Date(new Date().setDate(today.getDate() - 1));
                break;
            case '1w': fromDate = new Date(new Date().setDate(today.getDate() - 7));
                break;
            case '1m': fromDate = new Date(new Date().setMonth(today.getMonth() - 1));
                break;
            case '1y': fromDate = new Date(new Date().setFullYear(today.getFullYear() - 1));
                break;
        }
        if (fromDate) cqlParts.push(`lastModified >= "${fromDate.toISOString().split('T')[0]}"`);
        if (typeVal) cqlParts.push(`type="${typeVal}"`);
        const finalCQL = cqlParts.join(' AND ');
        log.debug('[CQL] Built:', finalCQL);
        return encodeURIComponent(finalCQL);
    }
    function resetDataAndFetchResults() {
        log.debug('[Search] Resetting data and fetching fresh results');
        const encodeLabel = (input) => {
            const key = input.dataset.key || '';
            const val = input.value?.trim() || '';
            return key ? `${key}:${val}` : '';
        };

        updateUrlParams({
            searchText,
            baseUrl,
            text: textFilterInput.value.trim(),
            space: encodeLabel(spaceFilterInput),
            contributor: encodeLabel(contributorFilterInput),
            date: dateFilter.value,
            type: typeFilter.value
        });
        nodeMap = {};
        roots = [];
        searchResultIds = new Set();
        allExpanded = true;
        loading = false;
        allResultsLoaded = false;
        isFetching = false;
        start = 0;
        totalSize = null;
        allResults = [];
        filteredResults = [];
        fullSpaceList = [];
        fullContributorList = [];
        currentSortColumn = '';
        currentSortOrder = ''; // Reset sort
        treeContainer.innerHTML = '';
        tableContainer.innerHTML = '';
        spaceOptionsContainer.innerHTML = '';
        contributorOptionsContainer.innerHTML = '';
        loadMoreResults();
    }
    async function performNewSearch(query) {
        if (!query) {
            alert('Please enter a search query.');
            return;
        }
        if (!isValidInput(query)) {
            alert('Invalid search query.');
            return;
        }
        searchText = sanitizeInput(query);
        log.info(`[Search] Starting new search for: "${searchText}"`);
        document.title = `Search results for '${escapeHtml(searchText)}' on ${domainName}`;
        document.getElementById('page-title').textContent = `(${domainName})`;
        chrome.storage.local.set({ lastSearchText: searchText });
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('searchText', searchText);
        newUrl.searchParams.set('baseUrl', baseUrl);
        history.replaceState(null, '', newUrl.toString());
        resetDataAndFetchResults();
    }
    async function loadMoreResults() {
        if (loading || allResultsLoaded || isFetching) return;
        isFetching = true;
        log.debug('[Search] Loading more results...');
        showLoadingIndicator(true);
        const cql = buildCQL();
        const searchUrl = `${baseUrl}/rest/api/content/search?cql=${cql}&limit=${RESULTS_PER_REQUEST}&start=${start}&expand=ancestors,space.icon,history.createdBy,version`;
        try {
            const response = await fetch(searchUrl, { method: 'GET', headers: { 'Accept': 'application/json' }, credentials: 'include' });
            if (!response.ok) throw new Error(`Workspace error: ${response.statusText}`);
            const searchData = await response.json();
            if (totalSize === null) totalSize = searchData.totalSize;
            const results = searchData.results || [];
            if (results.length === 0) {
                allResultsLoaded = true;
                if (allResults.length === 0) showNoResultsMessage();
            } else {
                start += results.length;
                log.debug(`[Search] Fetched ${results.length} results. Total: ${start} of ${totalSize || '?'}`);
                results.forEach(pageData => {
                    if (!searchResultIds.has(pageData.id)) {
                        searchResultIds.add(pageData.id);
                        allResults.push(pageData);
                        getStoredSummary(pageData.id, baseUrl).then(entry => { // Non-blocking
                            if (entry?.summaryHtml) {
                                summaryCache.set(pageData.id, entry.summaryHtml);
                                renderResults();
                            }
                        }).catch(e => log.warn('Error preloading summary:', e));
                    }
                });
                updateFilterOptions();
                filterResults(true); // Re-filter and render
                if (start >= totalSize) allResultsLoaded = true;
            }
        } catch (err) {
            log.error('[Search] Failed to fetch results:', err);
            alert(`An error occurred: ${err.message}`);
            allResultsLoaded = true;
        } finally {
            showLoadingIndicator(false);
            loading = false;
            isFetching = false;
            if (!allResultsLoaded && currentScrollTarget) {
                attachScrollListener(currentScrollTarget);
                // Slightly scroll up to break "at bottom" state
                requestAnimationFrame(() => {
                    currentScrollTarget.scrollTop -= 1;
                });
            }
        }
    }

    // =========================================================
    //                  FILTER & SORT FUNCTIONS
    // =========================================================
    async function updateFilterOptions() {
        const newSpaces = [], newContributors = [];
        const currentBatch = allResults.slice(Math.max(0, start - RESULTS_PER_REQUEST)); // Process only the newly fetched batch

        currentBatch.forEach(pageData => {
            if (pageData.space?.key && !fullSpaceList.find(s => s.key === pageData.space.key) && !newSpaces.find(s => s.key === pageData.space.key)) {
                const iconUrl = pageData.space.icon?.path ? `${baseUrl}${pageData.space.icon.path}` : `${baseUrl}/images/logo/default-space-logo.svg`;
                newSpaces.push({ key: pageData.space.key, name: pageData.space.name, iconUrl });
                pageData.space.iconUrl = iconUrl; // Cache for table view
            }
            const creator = pageData.history?.createdBy;
            if (creator) {
                const key = creator.username || creator.userKey || creator.accountId;
                if (key && !fullContributorList.find(c => c.key === key) && !newContributors.find(c => c.key === key)) {
                    const avatarUrl = `${baseUrl}${creator.profilePicture?.path || '/images/icons/profilepics/default.png'}`;
                    newContributors.push({ key, name: creator.displayName, avatarUrl });
                    creator.avatarUrl = avatarUrl; // Cache for table view
                }
            }
        });
        if (newSpaces.length > 0) {
            fullSpaceList.push(...newSpaces);
            fullSpaceList.sort((a, b) => a.name.localeCompare(b.name));
        }
        if (newContributors.length > 0) {
            fullContributorList.push(...newContributors);
            fullContributorList.sort((a, b) => a.name.localeCompare(b.name));
        }
        displayFilteredSpaceOptions(spaceFilterInput.value);
        displayFilteredContributorOptions(contributorFilterInput.value);
    }
    function displayFilteredSpaceOptions(filterValue) {
        spaceOptionsContainer.innerHTML = '';
        const filtered = fullSpaceList.filter(s => s.name.toLowerCase().includes(filterValue.toLowerCase()) || s.key.toLowerCase().includes(filterValue.toLowerCase()));
        filtered.forEach(space => {
            const option = document.createElement('div');
            option.className = 'option';
            option.dataset.key = space.key;
            option.title = space.name;
            option.innerHTML = `<img src="${space.iconUrl}" class="space-icon" alt=""> ${escapeHtml(space.name)}`;
            spaceOptionsContainer.appendChild(option);
        });
        addOptionListeners(spaceOptionsContainer, 'space-filter');
    }
    function displayFilteredContributorOptions(filterValue) {
        contributorOptionsContainer.innerHTML = '';
        const filtered = fullContributorList.filter(c => c.name.toLowerCase().includes(filterValue.toLowerCase()) || c.key.toLowerCase().includes(filterValue.toLowerCase()));
        filtered.forEach(contributor => {
            const option = document.createElement('div');
            option.className = 'option';
            option.dataset.key = contributor.key;
            option.title = contributor.name;
            option.innerHTML = `<img src="${contributor.avatarUrl}" class="contributor-avatar" alt=""> ${escapeHtml(contributor.name)}`;
            contributorOptionsContainer.appendChild(option);
        });
        addOptionListeners(contributorOptionsContainer, 'contributor-filter');
    }
    function filterResults(force = false) {
        const textValue = textFilterInput.value.toLowerCase();
        const spaceKey = spaceFilterInput.dataset.key || '';
        const contributorKey = contributorFilterInput.dataset.key || '';
        if (!force && textValue === lastTextFilter && spaceKey === lastSpaceKey && contributorKey === lastContributorKey) return;
        log.debug('[Filter] Filtering results...', { textValue, spaceKey, contributorKey });
        lastTextFilter = textValue;
        lastSpaceKey = spaceKey;
        lastContributorKey = contributorKey;
        filteredResults = allResults.filter(page => {
            const matchesText = !textValue || page.title.toLowerCase().includes(textValue);
            const matchesSpace = !spaceKey || page.space?.key === spaceKey;
            const creator = page.history?.createdBy;
            const matchesContributor = !contributorKey || (creator && (creator.username === contributorKey || creator.userKey === contributorKey || creator.accountId === contributorKey));
            return matchesText && matchesSpace && matchesContributor;
        });
        if (currentSortColumn && currentSortOrder) sortResults(currentSortColumn, currentSortOrder);
        else renderResults();
    }
    function sortResults(column, order) {
        log.debug('[Sort] Sorting results...', { column, order });
        filteredResults.sort((a, b) => {
            let valA, valB;
            switch (column) {
                case 'Type': valA = typeLabels[a.type] || '';
                    valB = typeLabels[b.type] || '';
                    break;
                case 'Name': valA = a.title.toLowerCase();
                    valB = b.title.toLowerCase();
                    break;
                case 'Space': valA = a.space?.name.toLowerCase() || '';
                    valB = b.space?.name.toLowerCase() || '';
                    break;
                case 'Contributor': valA = a.history?.createdBy?.displayName.toLowerCase() || '';
                    valB = b.history?.createdBy?.displayName.toLowerCase() || '';
                    break;
                case 'Date Created': valA = new Date(a.history?.createdDate || 0);
                    valB = new Date(b.history?.createdDate || 0);
                    break;
                case 'Last Modified': valA = new Date(a.version?.when || 0);
                    valB = new Date(b.version?.when || 0);
                    break;
                default: return 0;
            }
            if (valA < valB) return order === 'asc' ? -1 : 1;
            if (valA > valB) return order === 'asc' ? 1 : -1;
            return 0;
        });
        renderResults();
    }

    // =========================================================
    //                  UI RENDERING FUNCTIONS
    // =========================================================
    function renderResults() {
        if (filteredResults.length === 0 && allResultsLoaded && allResults.length > 0) { // Check allResults to ensure it's not an initial empty load
            showNoResultsMessage();
        } else {
            const prevScrollTop = document.querySelector('.table-body-wrapper')?.scrollTop || 0;
            updateTableHtml(filteredResults);
            document.querySelector('.table-body-wrapper')?.scrollTo({ top: prevScrollTop });
            updateTreeHtml(filteredResults);
            addEventListeners(); // Re-attach for new elements
        }
    }
    function generateTreeHtml(nodes) {
        let html = '<ul>';
        for (const node of nodes) {
            const isResult = node.isSearchResult;
            const hasChildren = node.children.length > 0;
            const id = `node-${node.id}`;
            const isCollapsed = collapsedNodes.has(id);
            const arrowClass = hasChildren ? (isCollapsed ? 'collapsed' : 'expanded') : 'empty';
            const tooltipAttrs = isResult ? ` data-title="${escapeHtml(node.title)}" data-contributor="${escapeHtml(node.contributor)}" data-modified="${escapeHtml(node.modified)}" data-type="${node.type}"` : '';
            const icon = typeIcons[node.type] || '📄';
            html += `<li id="${id}" class="${isResult ? 'search-result' : 'ancestor'}"${tooltipAttrs}>`;
            html += `<span class="arrow ${arrowClass}"></span> <a href="${node.url}" class="tree-node" target="_blank">${isResult ? `${icon}&nbsp;&nbsp;` : ''}${escapeHtml(node.title)}</a>`;
            if (isResult && window.ENABLE_SUMMARIES) {
                const btnText = summaryCache.has(node.id) ? '✅ Summary Available!' : '🧠 Summarize';
                html += `<div><button class="summarize-button" data-id="${node.id}">${btnText}</button></div>`;
            }
            if (hasChildren) { html += `<div class="children" style="display: ${isCollapsed ? 'none' : 'block'};">${generateTreeHtml(node.children)}</div>`; }
            html += '</li>';
        }
        html += '</ul>';
        return html;
    }
    function updateTreeHtml(results) {
        // Preserve collapsed state before rebuilding
        const currentCollapsed = document.querySelectorAll('.arrow.collapsed');
        collapsedNodes.clear();
        currentCollapsed.forEach(arrow => {
            const li = arrow.closest('li');
            if (li?.id) collapsedNodes.add(li.id);
        });

        nodeMap = {};
        roots = []; // Reset before build

        for (const pageData of results) {
            if (pageData.ancestors) {
                for (const ancestor of pageData.ancestors) {
                    if (!nodeMap[ancestor.id]) {
                        nodeMap[ancestor.id] = { id: ancestor.id, title: ancestor.title, url: buildConfluenceUrl(ancestor._links.webui), children: [], isSearchResult: false, type: 'page' }; // Type for icon
                    }
                }
            }
            if (!nodeMap[pageData.id]) {
                nodeMap[pageData.id] = {
                    id: pageData.id, title: pageData.title, url: buildConfluenceUrl(pageData._links.webui), children: [], isSearchResult: true,
                    contributor: pageData.history?.createdBy?.displayName || 'Unknown',
                    modified: pageData.version?.when ? formatDate(pageData.version.when) : 'N/A',
                    type: pageData.type || 'page'
                };
            }
        }
        for (const pageData of results) {
            const pageNode = nodeMap[pageData.id];
            if (!pageNode) continue;
            const ancestors = pageData.ancestors || [];
            if (ancestors.length > 0) {
                let parentNode = null;
                for (const ancestorData of ancestors) {
                    const ancestorNode = nodeMap[ancestorData.id];
                    if (!ancestorNode) continue;
                    if (parentNode && !parentNode.children.some(child => child.id === ancestorNode.id)) { parentNode.children.push(ancestorNode); }
                    parentNode = ancestorNode;
                }
                if (parentNode && !parentNode.children.some(child => child.id === pageNode.id)) { parentNode.children.push(pageNode); }
                const rootAncestor = nodeMap[ancestors[0].id];
                if (rootAncestor && !roots.some(root => root.id === rootAncestor.id)) { roots.push(rootAncestor); }
            } else {
                if (!roots.some(root => root.id === pageNode.id)) { roots.push(pageNode); }
            }
        }
        log.debug(`[Tree] Rendering with ${roots.length} root nodes. NodeMap size: ${Object.keys(nodeMap).length}`);
        treeContainer.innerHTML = generateTreeHtml(roots);
        updateTooltipState();
    }
    function updateSortIcons() {
        document.querySelectorAll('#table-container th').forEach(th => {
            const icon = th.querySelector('.sort-icon');
            const col = th.dataset.column;
            if (!icon) return;

            if (currentSortColumn === col) {
                icon.textContent = currentSortOrder === 'asc' ? '↑' :
                    currentSortOrder === 'desc' ? '↓' : '';
            } else {
                icon.textContent = '';
            }
        });
    }
    function updateTableHtml(results) {
        log.debug('[Table] Rendering', results.length, 'rows');
        tableContainer.innerHTML = '';

        // Header container
        const headerWrapper = document.createElement('div');
        headerWrapper.className = 'table-header-wrapper';

        // Body scrollable container
        const bodyWrapper = document.createElement('div');
        bodyWrapper.className = 'table-body-wrapper';

        // Table for header
        const headerTable = document.createElement('table');
        headerTable.style.tableLayout = 'fixed';
        headerTable.style.width = '100%';

        const headerColGroup = document.createElement('colgroup');
        const resizerElements = [];

        colWidths.forEach((width) => {
            const col = document.createElement('col');
            col.style.width = `${width}px`;
            headerColGroup.appendChild(col);
        });

        headerTable.appendChild(headerColGroup);

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        const headers = ['Type', 'Name', 'Space', 'Contributor', 'Date Created', 'Last Modified'];

        headers.forEach((headerText, idx) => {
            const th = document.createElement('th');
            th.dataset.column = headerText;
            const resizer = document.createElement('span');
            resizer.className = 'th-resizer';
            resizerElements.push({ el: resizer, idx });
            th.innerHTML = `<span>${headerText}</span><span class="sort-icon"></span>`;
            th.appendChild(resizer);
            th.addEventListener('click', handleSortClick);
            headerRow.appendChild(th);
        });

        thead.appendChild(headerRow);
        headerTable.appendChild(thead);
        headerWrapper.appendChild(headerTable);

        // Table for body
        const bodyTable = document.createElement('table');
        bodyTable.style.tableLayout = 'fixed';
        bodyTable.style.width = '100%';

        const bodyColGroup = document.createElement('colgroup');
        colWidths.forEach(width => {
            const col = document.createElement('col');
            col.style.width = `${width}px`;
            bodyColGroup.appendChild(col);
        });
        bodyTable.appendChild(bodyColGroup);

        const tbody = document.createElement('tbody');
        results.forEach(page => {
            const row = document.createElement('tr');
            const creator = page.history?.createdBy;
            const creatorId = creator ? (creator.username || creator.userKey || creator.accountId) : '';
            row.innerHTML = `
            <td><span title="${typeLabels[page.type] || page.type}" style="font-size: 2.0em;">${typeIcons[page.type] || '📄'}</span></td>
            <td><div style="display: flex; flex-direction: column; align-items: flex-start;"><a href="${buildConfluenceUrl(page._links.webui)}" target="_blank" class="multiline-ellipsis" title="${escapeHtml(page.title)}">${escapeHtml(page.title)}</a><button class="summarize-button" data-id="${page.id}" style="display: ${window.ENABLE_SUMMARIES ? 'inline-block' : 'none'};">${summaryCache.has(page.id) ? '✅ Summary Available!' : '🧠 Summarize'}</button></div></td>
            <td>${page.space ? `<div class="space-cell"><img src="${page.space.iconUrl || `${baseUrl}/images/logo/default-space-logo.svg`}" class="space-icon" alt=""><a href="${buildConfluenceUrl(page.space._links?.webui)}" target="_blank" class="multiline-ellipsis" title="${escapeHtml(page.space.name)}">${escapeHtml(page.space.name)}</a></div>` : ''}</td>
            <td>${creator ? `<div class="contributor-cell"><img src="${creator.avatarUrl || `${baseUrl}/images/icons/profilepics/default.png`}" class="contributor-avatar" alt="" loading="lazy"><a href="${creatorId ? `${baseUrl}/display/~${creatorId}` : '#'}" target="_blank" class="multiline-ellipsis" title="${escapeHtml(creator.displayName)}">${escapeHtml(creator.displayName)}</a></div>` : 'Unknown'}</td>
            <td>${page.history?.createdDate ? formatDate(page.history.createdDate) : 'N/A'}</td>
            <td>${page.version?.when ? formatDate(page.version.when) : 'N/A'}</td>`;
            tbody.appendChild(row);
        });

        bodyTable.appendChild(tbody);
        bodyWrapper.appendChild(bodyTable);

        // Attach resizers after both colgroups exist
        resizerElements.forEach(({ el, idx }) =>
            attachColResizer(el, idx, headerColGroup, bodyColGroup)
        );

        tableContainer.appendChild(headerWrapper);
        tableContainer.appendChild(bodyWrapper);
        updateSortIcons();
        syncTableHorizontalScroll();
    }

    function attachColResizer(resizerEl, idx, headerColGroup, bodyColGroup, minWidth = 60) {
        const headerCols = headerColGroup.children;
        const bodyCols = bodyColGroup.children;

        const syncWidths = () => {
            for (let i = 0; i < colWidths.length; i++) {
                headerCols[i].style.width = `${colWidths[i]}px`;
                bodyCols[i].style.width = `${colWidths[i]}px`;
            }
        };

        resizerEl.addEventListener('pointerdown', e => {
            e.preventDefault();
            e.stopPropagation();
            const startX = e.clientX;
            const startW = colWidths[idx];
            const move = ev => {
                colWidths[idx] = Math.max(startW + ev.clientX - startX, minWidth);
                syncWidths();
            };
            const up = () => {
                document.body.style.cursor = '';
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
            };
            document.body.style.cursor = 'col-resize';
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        });

        resizerEl.addEventListener('dblclick', e => {
            e.preventDefault();
            e.stopPropagation();
            colWidths[idx] = DEFAULT_COL_WIDTHS[idx];
            syncWidths();
        });
    }

    function syncTableHorizontalScroll() {
        const tableBodyWrapper = document.querySelector('.table-body-wrapper');
        const tableHeaderWrapper = document.querySelector('.table-header-wrapper');
        if (tableBodyWrapper && tableHeaderWrapper) {
            if (tableBodyWrapper.dataset.syncScrollAttached === 'true') {
                log.debug('Table scroll synchronization already set up.');
                return;
            }

            log.debug('Setting up table scroll synchronization');
            tableBodyWrapper.addEventListener('scroll', () => {
                tableHeaderWrapper.scrollLeft = tableBodyWrapper.scrollLeft;
            });
            tableBodyWrapper.dataset.syncScrollAttached = 'true';
        } else {
            log.warn('Table scroll synchronization not set up: tableBodyWrapper or tableHeaderWrapper is missing.');
        }
    }

    function attachScrollListener(target) {
        if (!target || target === currentScrollTarget) return;
        if (currentScrollTarget) {
            currentScrollTarget.removeEventListener('scroll', infiniteScrollHandler);
            currentScrollTarget.removeEventListener('scroll', handleScrollToTopVisibility);
        }
        currentScrollTarget = target;
        currentScrollTarget.addEventListener('scroll', infiniteScrollHandler);
        currentScrollTarget.addEventListener('scroll', handleScrollToTopVisibility);
    }

    function handleScrollToTopVisibility() {
        if (!currentScrollTarget) return;
        scrollToTopButton.style.display = currentScrollTarget.scrollTop > 200 ? 'block' : 'none';
    }

    // =========================================================
    //                    TOOLTIP FUNCTIONS
    // =========================================================
    function attachTooltipListeners() {
        const tooltip = document.getElementById('tree-tooltip');
        if (!tooltip) return;
        document.querySelectorAll('.search-result').forEach(node => {
            if (tooltipBoundNodes.has(node)) return;
            const enter = () => {
                tooltip.innerHTML = `<strong>${node.dataset.title}</strong><br>Type: ${typeLabels[node.dataset.type] || 'N/A'}<br>By: ${node.dataset.contributor}<br>Modified: ${node.dataset.modified}`;
                tooltip.style.display = 'block';
            };
            const move = e => {
                tooltip.style.left = `${e.pageX + 10}px`;
                tooltip.style.top = `${e.pageY + 10}px`;
            };
            const leave = () => { tooltip.style.display = 'none'; };
            node.addEventListener('mouseenter', enter);
            node.addEventListener('mousemove', move);
            node.addEventListener('mouseleave', leave);
            tooltipBoundNodes.set(node, { enter, move, leave });
        });
    }
    function detachTooltipListeners() {
        const tooltip = document.getElementById('tree-tooltip');
        if (tooltip) tooltip.style.display = 'none';
        document.querySelectorAll('.search-result').forEach(node => {
            const handlers = tooltipBoundNodes.get(node);
            if (handlers) {
                node.removeEventListener('mouseenter', handlers.enter);
                node.removeEventListener('mousemove', handlers.move);
                node.removeEventListener('mouseleave', handlers.leave);
                tooltipBoundNodes.delete(node);
            }
        });
    }
    function updateTooltipState() {
        let tooltip = document.getElementById('tree-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'tree-tooltip';
            tooltip.className = 'tree-tooltip';
            document.body.appendChild(tooltip);
        }
        chrome.storage.sync.get(['showTooltips'], (data) => {
            tooltipSettings.showTooltips = data.showTooltips !== false;
            detachTooltipListeners();
            if (tooltipSettings.showTooltips) attachTooltipListeners();
        });
    }

    // =========================================================
    //                  MODAL & AI FUNCTIONS
    // =========================================================
    function showConfirmationDialog(messageHtml, onConfirm) {
        log.debug('[Dialog] Showing confirmation');
        const existing = document.getElementById('dialog-overlay');
        if (existing) existing.remove();
        const dialog = document.createElement('div');
        dialog.id = 'dialog-overlay';
        dialog.className = 'dialog-overlay';
        dialog.innerHTML = `<div class="dialog-content"><span class="dialog-close">&times;</span><p>${messageHtml}</p><div class="dialog-actions"><button id="dialog-cancel">Cancel</button><button id="dialog-confirm">Confirm</button></div></div>`;
        document.body.appendChild(dialog);
        const remove = () => dialog.remove();
        dialog.querySelector('.dialog-close').onclick = remove;
        dialog.querySelector('#dialog-cancel').onclick = remove;
        dialog.querySelector('#dialog-confirm').onclick = () => {
            remove();
            log.info('[Dialog] ✔ User confirmed');
            onConfirm();
        };
        dialog.onclick = (e) => { if (e.target === dialog) remove(); };
    }
    function resetSummaryButtons(buttons, label = '🧠 Summarize') {
        buttons.forEach(btn => {
            btn.textContent = label;
            btn.classList.remove('loading');
            btn.disabled = false;
        });
    }
    async function getUserPrompt(pageData) {
        log.debug('[Prompt] Building for', pageData.id);
        const bodyHtmlRaw = await fetchConfluenceBodyById(pageData.id);
        const bodyHtml = sanitizeHtmlWithDOM(bodyHtmlRaw);
        const localData = await new Promise(resolve => chrome.storage.local.get(['customUserPrompt'], resolve));
        const userPrompt = (localData.customUserPrompt || '').trim();
        const contentDetails = `
            --- Content Details ---\n
            Title: ${pageData.title}\n
            Contributor: ${pageData.history?.createdBy?.displayName || 'Unknown'}\n
            Created: ${pageData.history.createdDate || 'N/A'}\n
            Modified: ${pageData.version?.when ? formatDate(pageData.version.when) : 'N/A'}\n
            SpaceIcon: ${pageData.space?.icon?.path ? `${baseUrl}${pageData.space.icon.path}` : `${baseUrl}/images/logo/default-space-logo.svg`}\n
            Type: ${pageData.type}\nSpace: ${pageData.space?.name || 'N/A'}\n
            Parent Title: ${pageData.parentTitle || 'N/A'}\n
            URL: ${buildConfluenceUrl(pageData._links.webui)}\n
            Content (HTML): ${bodyHtml}`.trim();
        return (userPrompt ? `${userPrompt}\n\n` : '') + contentDetails;
    }
    function renderConversationThread(container, conversation) {
        container.innerHTML = '';
        conversation.slice(3).forEach(msg => {
            const div = document.createElement('div');
            div.className = `qa-entry ${msg.role}`;
            const dir = detectDirection(msg.content);
            div.setAttribute('dir', dir);
            div.style.textAlign = dir === 'rtl' ? 'right' : 'left';
            div.innerHTML = msg.role === 'assistant' ? msg.content : escapeHtml(msg.content);
            container.appendChild(div);
        });
        requestAnimationFrame(() => container.parentElement.scrollTo({ top: container.parentElement.scrollHeight, behavior: 'smooth' }));
    }
    async function handleQaSubmit(contentId, inputEl, threadEl, submitBtn) {
        const question = inputEl.value.trim();
        if (!question) return;
        inputEl.value = '';
        inputEl.setAttribute('dir', 'ltr');
        submitBtn.disabled = true;
        const messages = conversationHistories.get(contentId);
        messages.push({ role: 'user', content: question });
        const userMsg = document.createElement('div');
        userMsg.className = 'qa-entry user';
        userMsg.dir = detectDirection(question);
        userMsg.textContent = question;
        threadEl.appendChild(userMsg);
        const typingBubble = document.createElement('div');
        typingBubble.className = 'qa-entry assistant typing-bubble';
        typingBubble.innerHTML = '<span class="typing-dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>';
        threadEl.appendChild(typingBubble);
        requestAnimationFrame(() => {
            const modalBody = document.getElementById('modal-body');
            if (modalBody) {
                modalBody.scrollTo({ top: modalBody.scrollHeight, behavior: 'smooth' });
            }
        });
        try {
            const { openaiApiKey, customApiEndpoint } = await new Promise(res => chrome.storage.sync.get(['openaiApiKey', 'customApiEndpoint'], res));
            const result = await sendOpenAIRequest({ apiKey: openaiApiKey, apiUrl: customApiEndpoint?.trim() || 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o', messages });
            const answer = result.choices?.[0]?.message?.content || '[No response]';
            messages.push({ role: 'assistant', content: answer });
            storeConversation(contentId, baseUrl, messages);
            typingBubble.remove();
            const reply = document.createElement('div');
            reply.className = 'qa-entry assistant';
            reply.dir = detectDirection(answer);
            reply.innerHTML = answer;
            threadEl.appendChild(reply);
            requestAnimationFrame(() => reply.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        } catch (err) {
            log.error('[QA] Error:', err);
            alert('Failed to get answer.');
            const bubble = threadEl.querySelector('.typing-bubble');
            if (bubble) bubble.remove();
        } finally { submitBtn.disabled = false; }
    }
    function handleClearConversation(contentId, threadEl, userPrompt, summaryText) {
        showConfirmationDialog('<h2>Are you sure you want to clear this conversation?</h2>', () => {
            triggerPoofEffect();
            const newConversation = [{ role: 'system', content: qaSystemPrompt }, { role: 'user', content: userPrompt }, { role: 'assistant', content: summaryText }];
            conversationHistories.set(contentId, newConversation);
            storeConversation(contentId, baseUrl, newConversation);
            renderConversationThread(threadEl, newConversation);
        });
    }
    async function handleResummarize(pageData, bodyHtml) {
        showConfirmationDialog('<h2>Are you sure you want to regenerate the summary?</h2>This will replace the current summary and reset the conversation.', async () => {
            const contentId = pageData.id;
            const overlay = document.getElementById('resummarize-loading-overlay');
            const allButtons = document.querySelectorAll(`.summarize-button[data-id="${contentId}"]`);
            overlay.style.display = 'flex';
            resetSummaryButtons(allButtons, 'Re-summarizing...');
            allButtons.forEach(b => {
                b.disabled = true;
                b.classList.add('loading');
            });
            try {
                const userPrompt = await getUserPrompt(pageData);
                const { openaiApiKey: apiKey, customApiEndpoint } = await new Promise(res => chrome.storage.sync.get(['openaiApiKey', 'customApiEndpoint'], res));
                const result = await sendOpenAIRequest({ apiKey, apiUrl: customApiEndpoint?.trim() || 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o', messages: [{ role: 'system', content: summarySystemPrompt }, { role: 'user', content: userPrompt }] });
                const newSummary = result.choices[0].message.content;
                summaryCache.set(contentId, newSummary);
                await storeSummary({ contentId, baseUrl, title: pageData.title, summaryHtml: newSummary, bodyHtml });
                const newConversation = [{ role: 'system', content: qaSystemPrompt }, { role: 'user', content: userPrompt }, { role: 'assistant', content: newSummary }];
                conversationHistories.set(contentId, newConversation);
                await storeConversation(contentId, baseUrl, newConversation);
                showSummaryModal(newSummary, pageData, bodyHtml);
                resetSummaryButtons(allButtons, '✅ Summary Available!');
            } catch (err) {
                log.error('Re-summarize failed:', err);
                alert('Failed to regenerate summary.');
                resetSummaryButtons(allButtons, '🧠 Summarize');
            } finally {
                overlay.style.display = 'none';
                document.getElementById('qa-submit').disabled = false;
                document.getElementById('qa-clear').disabled = false;
                document.getElementById('qa-resummarize').disabled = false;
            }
        });
    }
    function setupTextareaResizer(textarea) {
        const resizer = document.getElementById('qa-resizer');
        if (!resizer) return;
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
    async function showSummaryModal(summaryText, pageData, bodyHtml) {
        log.debug('Showing summary modal for', pageData.id);
        const modalBody = document.getElementById('modal-body');
        const closeBtn = document.getElementById('modal-close');
        const summaryTitle = document.getElementById('summary-title');

        // Reset scroll position immediately
        modalBody.scrollTop = 0;

        // Set title
        summaryTitle.innerHTML = `<strong>🧠 AI Summary</strong><br><a href="${buildConfluenceUrl(pageData._links.webui)}" target="_blank" title="${escapeHtml(pageData.title)}">${escapeHtml(pageData.title)}</a>`;

        // Prepare summary content
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = summaryText;
        tempDiv.querySelectorAll('p, li, h2, h3').forEach(el => el.setAttribute('dir', detectDirection(el.textContent)));

        const summaryDiv = document.createElement('div');
        summaryDiv.id = 'summary-content';
        summaryDiv.innerHTML = tempDiv.innerHTML;

        // Render modal content
        modalBody.innerHTML = `
        <div id="summary-thread-wrapper" style="display: flex; flex-direction: column; gap: 12px;">
            ${summaryDiv.outerHTML}
            <h3 class="conversation-title">💬 Follow-Up Questions</h3>
            <div id="qa-thread"></div>
            <button id="qa-scroll-top" title="Scroll to summary" style="display: none; align-self: flex-end;">⬆</button>
        </div>`;

        const modalContent = summaryModal.querySelector('.modal-content');
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
            <button id="qa-clear">🧹 Clear</button>
        </div>
        <div id="resummarize-loading-overlay">
            <div class="loader small-loader"></div>
            Regenerating...
        </div>`;
        modalContent.appendChild(qaInputArea);

        // Cache elements
        const qaThread = document.getElementById('qa-thread');
        const qaInput = document.getElementById('qa-input');
        const qaSubmit = document.getElementById('qa-submit');
        const qaClear = document.getElementById('qa-clear');
        const qaResummarize = document.getElementById('qa-resummarize');
        const qaScrollBtn = document.getElementById('qa-scroll-top');

        // Restore input height
        qaInput.style.height = `${sessionStorage.getItem('qaInputHeight') || 60}px`;
        setupTextareaResizer(qaInput);

        // Prepare conversation state
        const contentId = pageData.id;
        const userPrompt = await getUserPrompt(pageData);
        const storedConv = await getStoredConversation(contentId, baseUrl);
        const conversation = storedConv?.messages || [
            { role: 'system', content: qaSystemPrompt },
            { role: 'user', content: userPrompt },
            { role: 'assistant', content: summaryText }
        ];
        conversationHistories.set(contentId, conversation);
        storeConversation(contentId, baseUrl, conversation);
        renderConversationThread(qaThread, conversation);

        // Attach listeners
        qaSubmit.onclick = () => handleQaSubmit(contentId, qaInput, qaThread, qaSubmit);
        qaInput.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleQaSubmit(contentId, qaInput, qaThread, qaSubmit);
            }
        };
        qaInput.oninput = () => qaInput.setAttribute('dir', detectDirection(qaInput.value));
        qaClear.onclick = () => handleClearConversation(contentId, qaThread, userPrompt, summaryText);
        qaResummarize.onclick = () => handleResummarize(pageData, bodyHtml);
        qaScrollBtn.onclick = () => modalBody.scrollTo({ top: 0, behavior: 'smooth' });

        modalBody.onscroll = () => {
            qaScrollBtn.style.display = modalBody.scrollTop > 100 ? 'inline-block' : 'none';
        };

        // Force scroll-to-top button to hide if scrolling is not needed
        requestAnimationFrame(() => {
            if (modalBody.scrollHeight <= modalBody.clientHeight) {
                qaScrollBtn.style.display = 'none';
            }
        });

        summaryModal.style.display = 'flex';
        closeBtn.onclick = () => summaryModal.style.display = 'none';
        window.onclick = (e) => { if (e.target === summaryModal) summaryModal.style.display = 'none'; };
        document.onkeydown = (e) => { if (e.key === 'Escape') summaryModal.style.display = 'none'; };
    }

    function setupModalResizers() {
        const resizerRight = document.getElementById('modal-resizer');
        const resizerLeft = document.getElementById('modal-resizer-left');
        if (!resizableModal || !resizerRight || !resizerLeft) return;
        const savedWidth = sessionStorage.getItem('modalWidth');
        if (savedWidth) resizableModal.style.width = `${savedWidth}px`;
        const startResize = (e, direction) => {
            e.preventDefault();
            const startX = e.clientX, startWidth = resizableModal.offsetWidth;
            const move = (ev) => {
                const delta = (direction === 'right' ? ev.clientX - startX : startX - ev.clientX);
                const newWidth = Math.max(300, startWidth + 2 * delta);
                resizableModal.style.width = `${newWidth}px`;
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
            resizableModal.style.width = '600px';
            sessionStorage.removeItem('modalWidth');
        };
    }
    // =========================================================
    //                    EVENT HANDLERS
    // =========================================================
    function handleSortClick(event) {
        if (event.target.classList.contains('th-resizer')) return;

        const column = event.currentTarget.dataset.column;

        if (currentSortColumn === column) {
            if (currentSortOrder === 'asc') {
                currentSortOrder = 'desc';
            } else if (currentSortOrder === 'desc') {
                currentSortOrder = '';
                currentSortColumn = '';
            } else {
                currentSortOrder = 'asc';
            }
        } else {
            currentSortColumn = column;
            currentSortOrder = 'asc';
        }

        updateSortIcons();
        filterResults(true);
    }

    function handleTreeArrowClick(event) {
        const arrow = event.target.closest('.arrow');
        if (!arrow || arrow.classList.contains('empty')) return;
        const li = arrow.closest('li');
        const childrenDiv = li?.querySelector('.children');
        if (!childrenDiv) return;
        const isCollapsed = childrenDiv.style.display === 'none';
        childrenDiv.style.display = isCollapsed ? 'block' : 'none';
        arrow.classList.toggle('collapsed', !isCollapsed);
        arrow.classList.toggle('expanded', isCollapsed);
        if (li?.id) { isCollapsed ? collapsedNodes.delete(li.id) : collapsedNodes.add(li.id); }
    }
    async function handleSummarizeClick(event) {
        const btn = event.target.closest('.summarize-button');
        if (!btn) return;
        const contentId = btn.dataset.id;
        const pageData = allResults.find(r => r.id === contentId);
        if (!pageData) return log.warn('Content not found for summarization', contentId);
        const allButtons = document.querySelectorAll(`.summarize-button[data-id="${contentId}"]`);
        resetSummaryButtons(allButtons, 'Summarizing...');
        allButtons.forEach(b => {
            b.disabled = true;
            b.classList.add('loading');
        });
        try {
            const bodyHtml = await fetchConfluenceBodyById(contentId).then(sanitizeHtmlWithDOM);
            const stored = await getStoredSummary(contentId, baseUrl);
            if (stored?.summaryHtml) {
                log.debug(`[DB] Using cached summary for ${contentId}`);
                summaryCache.set(contentId, stored.summaryHtml);
                showSummaryModal(stored.summaryHtml, pageData, bodyHtml);
                resetSummaryButtons(allButtons, '✅ Summary Available!');
            } else {
                log.debug(`[AI] Requesting new summary for ${contentId}`);
                const { openaiApiKey, customApiEndpoint } = await new Promise(res => chrome.storage.sync.get(['openaiApiKey', 'customApiEndpoint'], res));
                if (!openaiApiKey) {
                    alert('OpenAI API key not set.');
                    resetSummaryButtons(allButtons);
                    return;
                }
                const userPrompt = await getUserPrompt(pageData);
                const result = await sendOpenAIRequest({ apiKey: openaiApiKey, apiUrl: customApiEndpoint?.trim() || 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o', messages: [{ role: 'system', content: summarySystemPrompt }, { role: 'user', content: userPrompt }] });
                const summary = result.choices[0].message.content;
                summaryCache.set(contentId, summary);
                await storeSummary({ contentId, baseUrl, title: pageData.title, summaryHtml: summary, bodyHtml });
                showSummaryModal(summary, pageData, bodyHtml);
                resetSummaryButtons(allButtons, '✅ Summary Available!');
            }
        } catch (err) {
            log.error('[Summary] Failed to summarize:', err);
            alert(`Failed to summarize content: ${err.message}`);
            resetSummaryButtons(allButtons, '🧠 Summarize');
        }
    }
    function switchToTreeView() {
        const treeBtn = document.getElementById('tree-view-btn');
        const isTreeActive = treeBtn.classList.contains('active');
        if (isTreeActive) {
            allExpanded = !allExpanded;
            log.debug('Toggling Tree View expand state to:', allExpanded);
            document.querySelectorAll('.children').forEach(div => div.style.display = allExpanded ? 'block' : 'none');
            document.querySelectorAll('.arrow:not(.empty)').forEach(arrow => {
                arrow.classList.toggle('collapsed', !allExpanded);
                arrow.classList.toggle('expanded', allExpanded);
            });
        } else {
            log.debug('Switching to Tree View');
            treeContainer.style.display = 'block';
            tableContainer.style.display = 'none';
            treeBtn.classList.add('active');
            document.getElementById('table-view-btn').classList.remove('active');
            allExpanded = true;
        }
        attachScrollListener(document.querySelector('.container'));
    }
    function switchToTableView() {
        log.debug('Switching to Table View');
        treeContainer.style.display = 'none';
        tableContainer.style.display = 'block';
        document.getElementById('tree-view-btn').classList.remove('active');
        document.getElementById('table-view-btn').classList.add('active');
        syncTableHorizontalScroll();
        attachScrollListener(document.querySelector('.table-body-wrapper'));
    }
    function onTypeFilterChange() {
        log.debug('[Filter] Type changed:', typeFilter.value);
        resetDataAndFetchResults();
    }
    function onDateFilterChange() {
        log.debug('[Filter] Date changed:', dateFilter.value);
        resetDataAndFetchResults();
    }
    function addOptionListeners(container, inputId) {
        container.querySelectorAll('.option').forEach(option => {
            option.onclick = () => {
                const input = document.getElementById(inputId);
                const clearIcon = document.getElementById(`${inputId.split('-')[0]}-clear`);
                input.value = option.textContent.trim();
                input.dataset.key = option.dataset.key;
                container.style.display = 'none';
                if (clearIcon) toggleClearIcon(input, clearIcon);
                resetDataAndFetchResults();
            };
        });
    }
    function clearSpaceFilter(evt) {
        evt.stopPropagation();
        log.debug('[Filter] Space filter cleared');
        spaceFilterInput.value = '';
        spaceFilterInput.dataset.key = '';
        toggleClearIcon(spaceFilterInput, document.getElementById('space-clear'));
        displayFilteredSpaceOptions('');
        resetDataAndFetchResults();
    }
    function clearContributorFilter(evt) {
        evt.stopPropagation();
        log.debug('[Filter] Contributor filter cleared');
        contributorFilterInput.value = '';
        contributorFilterInput.dataset.key = '';
        toggleClearIcon(contributorFilterInput, document.getElementById('contributor-clear'));
        displayFilteredContributorOptions('');
        resetDataAndFetchResults();
    }
    function infiniteScrollHandler() {
        if (!currentScrollTarget) return;
        const reached = currentScrollTarget.scrollTop + currentScrollTarget.clientHeight >= currentScrollTarget.scrollHeight - SCROLL_THRESHOLD_PX;
        if (reached) loadMoreResults();
    }
    function addEventListeners() {
        log.debug('Attaching/Re-attaching event listeners...');
        const debouncedFilter = debounce(filterResults, 250);
        newSearchButton.onclick = () => performNewSearch(newSearchInput.value.trim());
        newSearchInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                performNewSearch(newSearchInput.value.trim());
            }
        };
        newSearchInput.oninput = () => toggleClearIcon(newSearchInput, mainSearchClear);
        mainSearchClear.onclick = () => {
            newSearchInput.value = '';
            toggleClearIcon(newSearchInput, mainSearchClear);
            newSearchInput.focus();
        };
        document.getElementById('tree-view-btn').onclick = switchToTreeView;
        document.getElementById('table-view-btn').onclick = switchToTableView;
        treeContainer.removeEventListener('click', handleTreeArrowClick);
        treeContainer.addEventListener('click', handleTreeArrowClick);
        document.body.removeEventListener('click', handleSummarizeClick);
        document.body.addEventListener('click', handleSummarizeClick);
        textFilterInput.oninput = () => {
            debouncedFilter();
            toggleClearIcon(textFilterInput, document.getElementById('filter-text-clear'));
            // Update URL with current text filter after debounce
            debounce(() => {
                const currentParams = getQueryParams();
                currentParams.text = textFilterInput.value.trim();
                updateUrlParams(currentParams);
            }, 300)();
        };
        document.getElementById('filter-text-clear').onclick = () => {
            textFilterInput.value = '';
            toggleClearIcon(textFilterInput, document.getElementById('filter-text-clear'));
            filterResults(true);
            textFilterInput.focus();
        };
        dateFilter.onchange = onDateFilterChange;
        typeFilter.onchange = onTypeFilterChange;
        const setupFilterInput = (input, optionsContainer, displayFn, clearBtn) => {
            input.oninput = evt => {
                displayFn(sanitizeInput(evt.target.value));
                optionsContainer.style.display = 'block';
                toggleClearIcon(input, clearBtn);
            };
            input.onfocus = evt => {
                displayFn(evt.target.value);
                optionsContainer.style.display = 'block';
            };
        };
        setupFilterInput(spaceFilterInput, spaceOptionsContainer, displayFilteredSpaceOptions, document.getElementById('space-clear'));
        setupFilterInput(contributorFilterInput, contributorOptionsContainer, displayFilteredContributorOptions, document.getElementById('contributor-clear'));
        document.getElementById('space-clear').onclick = clearSpaceFilter;
        document.getElementById('contributor-clear').onclick = clearContributorFilter;
        document.onclick = evt => {
            if (!evt.target.closest('#space-filter-container')) spaceOptionsContainer.style.display = 'none';
            if (!evt.target.closest('#contributor-filter-container')) contributorOptionsContainer.style.display = 'none';
        };
        scrollToTopButton.onclick = () => {
            currentScrollTarget?.scrollTo({ top: 0, behavior: 'smooth' });
        };

        const isTreeView = document.getElementById('tree-view-btn').classList.contains('active');
        const initialScrollTarget = isTreeView
            ? document.querySelector('.container')
            : document.querySelector('.table-body-wrapper');
        attachScrollListener(initialScrollTarget);

        document.getElementById('open-options').onclick = () => { chrome.runtime.openOptionsPage ? chrome.runtime.openOptionsPage() : window.open(chrome.runtime.getURL('options/options.html')); };
        setupModalResizers();
        // Initial state for clear icons after potential init value setting
        toggleClearIcon(textFilterInput, document.getElementById('filter-text-clear'));
        toggleClearIcon(spaceFilterInput, document.getElementById('space-clear'));
        toggleClearIcon(contributorFilterInput, document.getElementById('contributor-clear'));
        toggleClearIcon(newSearchInput, mainSearchClear);

        chrome.runtime.onMessage.addListener((message) => {
            if (message.action === 'summariesCleared') {
                summaryCache.clear();
                document.querySelectorAll('.summarize-button').forEach(btn => {
                    btn.textContent = '🧠 Summarize';
                    btn.disabled = false;
                    btn.classList.remove('loading');
                });
                log.info('[UI] Summary cache cleared and summarize buttons reset.');
            }
        });
    }

    // =========================================================
    //                    INITIALIZATION
    // =========================================================
    async function init() {
        log.info(`Initializing Enhanced Search Results page (DB_VERSION: ${DB_VERSION})...`);
        const params = getQueryParams();
        searchText = (params.searchText || '').trim();
        baseUrl = sanitiseBaseUrl(params.baseUrl || window.location.origin);
        domainName = baseUrl ? new URL(baseUrl).hostname : 'Unknown';
        populateFiltersFromUrlParams(params);
        if (!searchText) log.warn('No searchText parameter received!');
        if (!baseUrl) {
            log.error('Invalid or missing baseUrl! Extension may not function correctly.');
            return;
        }
        document.title = `Search: '${escapeHtml(searchText)}' on ${domainName}`;
        document.getElementById('page-title').textContent = `Results (${domainName})`;
        newSearchInput.value = searchText;
        try {
            const data = await new Promise(res => chrome.storage.sync.get(['darkMode', 'resultsPerRequest', 'enableSummaries', 'openaiApiKey'], res));
            document.body.classList.toggle('dark-mode', Boolean(data.darkMode));
            RESULTS_PER_REQUEST = Number.isInteger(data.resultsPerRequest) ? data.resultsPerRequest : 75;
            window.ENABLE_SUMMARIES = data.enableSummaries !== false && !!data.openaiApiKey;
            log.debug('Settings loaded:', { perRequest: RESULTS_PER_REQUEST, summaries: window.ENABLE_SUMMARIES });
        } catch (error) { log.error('Failed to load settings:', error); }
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'sync') return;
            if (changes.darkMode) document.body.classList.toggle('dark-mode', changes.darkMode.newValue);
            if (changes.showTooltips) {
                tooltipSettings.showTooltips = changes.showTooltips.newValue !== false;
                updateTooltipState();
            }
            if ('enableSummaries' in changes || 'openaiApiKey' in changes) {
                chrome.storage.sync.get(['enableSummaries', 'openaiApiKey'], (data) => {
                    window.ENABLE_SUMMARIES = data.enableSummaries === true && !!data.openaiApiKey;
                    renderResults();
                });
            }
        });
        addEventListeners(); // Call once after DOM elements are certain
        document.getElementById('tree-container').style.display = 'block'; // Default view
        if (searchText && baseUrl) performNewSearch(searchText);
        else {
            showNoResultsMessage();
            showLoadingIndicator(false);
        }
        log.info('Initialization complete.');
    }
    init().catch(err => log.error('Initialization failed:', err));
});