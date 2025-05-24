document.addEventListener('DOMContentLoaded', () => {
    // ========== INDEXEDDB UTILITIES ==========
    const DB_NAME = 'ConfluenceSummariesDB';
    const DB_VERSION = 2;
    const STORE_NAME = 'summaries';

    function openDb() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: ['contentId', 'baseUrl'] });
                }
                if (!db.objectStoreNames.contains('conversations')) {
                    db.createObjectStore('conversations', { keyPath: ['contentId', 'baseUrl'] });
                }
            };
        });
    }

    async function getStoredSummary(contentId, baseUrl) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get([contentId, baseUrl]);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function storeSummary({ contentId, baseUrl, title, summaryHtml, bodyHtml }) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const entry = {
                contentId,
                baseUrl,
                title,
                summaryHtml,
                bodyHtml,
                timestamp: Date.now()
            };
            const request = store.put(entry);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async function storeConversation(contentId, baseUrl, messages) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('conversations', 'readwrite');
            const store = tx.objectStore('conversations');
            const entry = {
                contentId,
                baseUrl,
                messages,
                timestamp: Date.now()
            };
            const request = store.put(entry);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async function getStoredConversation(contentId, baseUrl) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('conversations', 'readonly');
            const store = tx.objectStore('conversations');
            const request = store.get([contentId, baseUrl]);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }


    /**
     * ========== CONSTANTS & GLOBALS ==========
     */
    // Load more only when scrolled to exact bottom
    const SCROLL_THRESHOLD_REACHED = (el) =>
        el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    let RESULTS_PER_REQUEST = 75; // default value, overridden from storage
    const DEBUG = false;

    const log = {
        debug: (...args) => DEBUG && console.debug('[DEBUG]', ...args),
        info: (...args) => console.info('[INFO]', ...args),
        warn: (...args) => console.warn('[WARN]', ...args),
        error: (...args) => console.error('[ERROR]', ...args)
    };

    let searchText = '';
    let baseUrl = '';
    let domainName = '';

    // Tree/Filtering/Sorting state
    let nodeMap = {};
    let roots = [];
    let searchResultIds = new Set();
    let allExpanded = true;
    let collapsedNodes = new Set(); // Track collapsed node IDs
    let loading = false;
    let isFetching = false; // Prevent overlapping fetch calls
    let allResultsLoaded = false;
    let start = 0;
    let totalSize = null;
    let allResults = [];
    let filteredResults = [];
    let spaceList = [];
    let contributorList = [];
    let fullSpaceList = [];
    let fullContributorList = [];
    const conversationHistories = new Map(); // contentId -> messages[]

    // Variables for sorting
    let currentSortColumn = '';
    let currentSortOrder = ''; // 'asc', 'desc', or ''

    let tooltipSettings = { showTooltips: true };

    const confluenceBodyCache = new Map();
    const summaryCache = new Map();

    const typeIcons = {
        page: '📘',
        blogpost: '📝',
        attachment: '📎',
        comment: '💬'
    };

    const typeLabels = {
        page: 'Page',
        blogpost: 'Blog Post',
        attachment: 'Attachment',
        comment: 'Comment'
    };

    const DEFAULT_COL_WIDTHS = [
        80,  // Type
        320, // Name
        200, // Space
        160, // Contributor
        100, // Date Created
        100  // Last Modified
    ];

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
        - Page: "This page, from the <b>[space]</b> space, covers..."
        - Blog post: "...published in..."
        - Comment: "...posted on the page titled..."
        - Attachment: "...uploaded to..."
        2. <h3> Main points</h3> followed by a <ul><li> list
        3. Keep tone concise, neutral, and useful. Avoid repeating title. Omit internal field names or Confluence-specific terms.

        Important: If a user prompt is provided, it must be addressed in the summary. Use it to focus the summary on what the user cares about.
    `;

    const qaSystemPrompt = `
        You are a helpful AI assistant answering follow-up questions about a Confluence document and its summary.
        Respond clearly, accurately, and in plain text. Avoid reiterating the full summary format.
        Answer as a helpful peer who understands the document’s purpose and key details.
        Output only valid, clean and nicely formatted HTML (no Markdown or code blocks, and no \`\`\`html)
    `;


    /**
     * ========== UTILITY FUNCTIONS ==========
     */

    // PROXY SERVER!
    async function sendOpenAIRequest({ apiKey, apiUrl, model, messages }) {
        log.debug('[Summary] Sending OpenAI request to:', apiUrl);
        const response = await fetch('http://localhost:3000/proxy', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                apiKey,
                apiUrl,
                model,
                messages
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[OpenAI] API error response:', errorText);
            throw new Error(`OpenAI request failed: ${response.statusText}`);
        }

        const result = await response.json();
        log.debug('[Summary] Received response from OpenAI.');
        log.debug('[Summary] Response structure:', {
            usage: result.usage,
            model: result.model,
            choicesLength: result.choices?.length
        });

        return result;
    }

    function showConfirmationDialog(message, onConfirm) {
        const existing = document.getElementById('dialog-overlay');
        if (existing) existing.remove();

        const dialog = document.createElement('div');
        dialog.id = 'dialog-overlay';
        dialog.className = 'dialog-overlay';
        dialog.innerHTML = `
            <div class="dialog-content">
                <span class="dialog-close" id="dialog-close">&times;</span>
                <p>${message}</p>
                <div class="dialog-actions">
                    <button id="dialog-cancel">Cancel</button>
                    <button id="dialog-confirm">Confirm</button>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);

        function remove() {
            dialog.remove();
        }

        document.getElementById('dialog-close').onclick = remove;
        document.getElementById('dialog-cancel').onclick = remove;
        document.getElementById('dialog-confirm').onclick = () => {
            remove();
            onConfirm();
        };

        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) remove();
        });
    }

    function resetSummaryButtons(buttons, label = '🧠 Summarize') {
        buttons.forEach(b => {
            b.textContent = label;
            b.classList.remove('loading');
            b.disabled = false;
        });
    }

    async function getUserPrompt(pageData) {
        const bodyHtmlRaw = await fetchConfluenceBodyById(pageData.id);
        const bodyHtml = sanitizeHtmlWithDOM(bodyHtmlRaw);

        const localData = await new Promise((resolve) => {
            chrome.storage.local.get(['customUserPrompt'], resolve);
        });

        const userPrompt = typeof localData.customUserPrompt === 'string'
            ? localData.customUserPrompt.trim()
            : '';

        let fullUserPrompt = userPrompt;
        const contentDetails = `
            --- Content Details ---
            Title: ${pageData.title}
            Contributor: ${pageData.history?.createdBy?.displayName || 'Unknown'}
            Created: ${pageData.history.createdDate || 'N/A'}
            Modified: ${pageData.version?.when ? formatDate(pageData.version.when) : 'N/A'}
            Type: ${pageData.type}
            Space: ${pageData.space?.name || 'N/A'}
            Parent Title: ${pageData.parentTitle || 'N/A'}
            URL: ${buildConfluenceUrl(pageData._links.webui)}
            Content (HTML): ${bodyHtml}
        `.trim();

        fullUserPrompt += (fullUserPrompt ? '\n\n' : '') + contentDetails;

        return fullUserPrompt;
    }


    function detectDirection(text) {
        const rtlChars = /[\u0590-\u05FF\u0600-\u06FF]/; // Hebrew + Arabic
        return rtlChars.test(text) ? 'rtl' : 'ltr';
    }

    function sanitizeHtmlWithDOM(htmlString) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'text/html');

        const forbiddenTags = ['script', 'style', 'iframe'];
        forbiddenTags.forEach(tag => {
            const elements = doc.querySelectorAll(tag);
            elements.forEach(el => el.remove());
        });

        // Remove comments
        const treeWalker = document.createTreeWalker(doc, NodeFilter.SHOW_COMMENT, null);
        let comment;
        while ((comment = treeWalker.nextNode())) {
            comment.parentNode.removeChild(comment);
        }

        return doc.body.innerHTML;
    }

    // Debounce utility
    function debounce(fn, delay) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn(...args), delay);
        };
    }

    // Get URL parameters
    function getQueryParams() {
        const params = {};
        const searchParams = new URLSearchParams(window.location.search);
        for (const [key, value] of searchParams.entries()) {
            params[key] = value;
        }
        return params;
    }

    function escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            '\'': '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    function isValidInput(input) {
        // Allow letters, numbers, spaces, -_.@ and double quotes for quoted phrases
        const regex = /^[\p{L}\p{N}\s\-_.@"']*$/u;
        return regex.test(input);
    }

    function sanitizeInput(input) {
        // Allow letters, numbers, spaces, -_.@, double quotes, and single quotes
        return input.replace(/[^\p{L}\p{N}\s\-_.@"']/gu, '');
    }

    function formatDate(dateString) {
        const date = new Date(dateString);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0'); // months are zero-based
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${day}/${month}/${year} at ${hours}:${minutes}`;
    }

    // ---- URL-security helpers ---------------------------------------------

    /**
     * Accepts the user-supplied baseUrl *once*, validates it and normalises it
     * to "<scheme>://<host>" (no path / query / fragment allowed).
     * Returns an empty string if the value is unsafe.
     */
    function sanitiseBaseUrl(raw) {
        try {
            const u = new URL(raw);
            // allow only http(s) and (optionally) an allow-list of hosts
            if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
            // If you only ever search the one Confluence host you can
            // replace the next line with e.g.
            // if (u.hostname !== 'confluence.mycorp.com') throw new Error();
            return u.origin;                // "https://confluence.mycorp.com"
        } catch (_) {
            console.error('Rejected baseUrl:', raw);
            return '';
        }
    }

    /**
     * Safely joins a *relative* Confluence path (e.g. "/spaces/FOO") onto the
     * already-sanitised baseUrl.
     * If the path is not a string or is absolute / schemeful, returns "#".
     */
    function buildConfluenceUrl(path) {
        if (typeof path !== 'string' ||
            path.startsWith('http:') ||
            path.startsWith('https:') ||
            path.includes('javascript:') ||
            path.includes('data:')) {
            return '#';
        }
        try {
            return new URL(path, baseUrl).toString();   // automatic encoding
        } catch (_) {
            return '#';
        }
    }

    const tooltipBoundNodes = new WeakMap(); // Tracks nodes already bound with their handlers

    function attachTooltipListeners() {
        const tooltip = document.getElementById('tree-tooltip');
        if (!tooltip) return;

        document.querySelectorAll('.search-result').forEach(node => {
            if (tooltipBoundNodes.has(node)) return;

            const enter = () => {
                const title = node.dataset.title;
                const contributor = node.dataset.contributor;
                const modified = node.dataset.modified;
                const nodeType = node.dataset.type || '';
                let typeLabel = '';
                switch (nodeType) {
                    case 'page': typeLabel = 'Page'; break;
                    case 'blogpost': typeLabel = 'Blog Post'; break;
                    case 'comment': typeLabel = 'Comment'; break;
                    case 'attachment': typeLabel = 'Attachment'; break;
                    default: typeLabel = '';
                }
                tooltip.innerHTML = `<strong>${title}</strong><br>Type: ${typeLabel}<br>By: ${contributor}<br>Last Modified: ${modified}`;
                tooltip.style.display = 'block';
            };

            const move = e => {
                tooltip.style.left = `${e.pageX + 10}px`;
                tooltip.style.top = `${e.pageY + 10}px`;
            };

            const leave = () => {
                tooltip.style.display = 'none';
            };

            node.addEventListener('mouseenter', enter);
            node.addEventListener('mousemove', move);
            node.addEventListener('mouseleave', leave);

            tooltipBoundNodes.set(node, { enter, move, leave });
        });
    }

    function detachTooltipListeners() {
        const tooltip = document.getElementById('tree-tooltip');
        if (!tooltip) return;

        document.querySelectorAll('.search-result').forEach(node => {
            const handlers = tooltipBoundNodes.get(node);
            if (handlers) {
                node.removeEventListener('mouseenter', handlers.enter);
                node.removeEventListener('mousemove', handlers.move);
                node.removeEventListener('mouseleave', handlers.leave);
                tooltipBoundNodes.delete(node);
            }
        });

        tooltip.style.display = 'none';
    }

    /**
     * ========== CORE LOGIC FUNCTIONS ==========
     */

    function buildCQL() {
        const cqlParts = [];
        // Escape backslash **first**, then double quotes
        const escapedSearchText = searchText.replace(/(["\\])/g, '\\$1');
        // Construct text query
        const textQuery = `(text ~ "${escapedSearchText}" OR title ~ "${escapedSearchText}")`;
        cqlParts.push(textQuery);

        // Grab filter values
        const spaceFilterValue = document.getElementById('space-filter').dataset.key || '';
        const contributorFilterValue = document.getElementById('contributor-filter').dataset.key || '';

        if (spaceFilterValue) {
            cqlParts.push(`space="${spaceFilterValue}"`);
        }
        if (contributorFilterValue) {
            cqlParts.push(`creator="${contributorFilterValue}"`);
        }

        const dateFilter = document.getElementById('date-filter');
        const dateVal = dateFilter ? dateFilter.value : 'any';
        const typeVal = typeFilter ? typeFilter.value : '';
        const today = new Date();
        let fromDate = null;

        if (dateVal === '1d') {
            fromDate = new Date(today.setDate(today.getDate() - 1));
        } else if (dateVal === '1w') {
            fromDate = new Date(today.setDate(today.getDate() - 7));
        } else if (dateVal === '1m') {
            fromDate = new Date(today.setMonth(today.getMonth() - 1));
        } else if (dateVal === '1y') {
            fromDate = new Date(today.setFullYear(today.getFullYear() - 1));
        }

        if (fromDate) {
            const isoDate = fromDate.toISOString().split('T')[0];
            cqlParts.push(`lastModified >= "${isoDate}"`);
        }

        // Only apply type filter if a specific type is selected (omit for "All Types")
        if (typeVal && ['page', 'blogpost', 'attachment', 'comment'].includes(typeVal)) {
            cqlParts.push(`type="${typeVal}"`);
        }

        const finalCQL = cqlParts.join(' AND ');
        log.debug('Applied filters:', {
            space: spaceFilterValue,
            contributor: contributorFilterValue,
            date: dateVal,
            query: escapedSearchText
        });
        return encodeURIComponent(finalCQL);
    }

    async function performNewSearch(query) {
        if (!query) {
            alert('Please enter a search query.');
            return;
        }
        if (!isValidInput(query)) {
            alert('Invalid search query. Please use only alphanumeric characters, spaces, and -_.@');
            return;
        }

        query = sanitizeInput(query);

        // Update document title
        document.title = `Search results for '${escapeHtml(query)}' on ${domainName}`;
        // Update the page header title
        document.getElementById('page-title').textContent = `(${domainName})`;

        log.info(`[Search] Starting new search for: "${query}"`);
        searchText = query;
        chrome.storage.local.set({ lastSearchText: query });

        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('searchText', query);
        newUrl.searchParams.set('baseUrl', baseUrl);
        history.replaceState(null, '', newUrl.toString());

        resetDataAndFetchResults();
    }

    function resetDataAndFetchResults() {
        log.debug('Resetting data and fetching fresh results');
        // Prevent scroll-triggered loadMoreResults while resetting
        window.removeEventListener('scroll', infiniteScrollHandler);
        // Reset variables
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
        spaceList = [];
        contributorList = [];
        fullSpaceList = [];
        fullContributorList = [];
        currentSortColumn = '';
        currentSortOrder = 'asc';

        // Clear containers
        document.getElementById('tree-container').innerHTML = '';
        document.getElementById('table-container').innerHTML = '';
        // Clear the filter options
        document.getElementById('space-options').innerHTML = '';
        document.getElementById('contributor-options').innerHTML = '';

        loadMoreResults();
    }

    async function loadMoreResults() {
        if (loading || allResultsLoaded || isFetching) return;
        isFetching = true;
        log.debug('[Search] Triggered loadMoreResults');
        log.debug('No results found after CQL search.');
        loading = true;
        showLoadingIndicator(true);

        const cql = buildCQL();
        // Updated search URL to include expand parameter
        const searchUrl = `${baseUrl}/rest/api/content/search?cql=${cql}&limit=${RESULTS_PER_REQUEST}&start=${start}&expand=ancestors,space.icon,history.createdBy,version`;

        try {
            const response = await fetch(searchUrl, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                credentials: 'include' // Include cookies for authentication
            });

            if (!response.ok) {
                throw new Error(`Error fetching search results: ${response.statusText}`);
            }

            const searchData = await response.json();
            if (totalSize === null) {
                totalSize = searchData.totalSize;
            }

            const results = searchData.results;
            if (results.length === 0) {
                log.debug('No results found after CQL search.');
                allResultsLoaded = true;
                if (allResults.length === 0) {
                    // No results at all
                    showNoResultsMessage();
                }
                showLoadingIndicator(false);
                return;
            }

            start += results.length;
            log.debug(`Fetched ${results.length} results. Total so far: ${allResults.length}`);

            // Process each result
            for (const pageData of results) {
                const pageId = pageData.id;
                if (searchResultIds.has(pageId)) {
                    continue; // Skip duplicates
                }
                searchResultIds.add(pageId);
                allResults.push(pageData); // Add to all results

                // Attempt to preload summary from IndexedDB
                getStoredSummary(pageId, baseUrl).then(entry => {
                    if (entry?.summaryHtml) {
                        summaryCache.set(pageId, entry.summaryHtml);
                        updateTreeHtml(filteredResults);
                        updateTableHtml(filteredResults);
                        addEventListeners();
                    }
                }).catch(() => {
                    log.debug('No stored summary for', pageId);
                });
            }

            // Update filter options (spaces/contributors)
            updateFilterOptions();

            // Re-filter and sort
            filteredResults = allResults.slice();
            filterResults(true); // force recalculation

            if (start >= totalSize) {
                allResultsLoaded = true;
            }
        } catch (err) {
            log.error('[Search] Failed to fetch search results:', err);
            alert(`An error occurred: ${err.message}`);
        }
        log.info(`[Search] Finished loading batch. Total loaded: ${allResults.length}`);
        showLoadingIndicator(false);
        loading = false;
        isFetching = false;
        window.addEventListener('scroll', infiniteScrollHandler);
    }

    async function updateFilterOptions() {
        const seenSpaceKeys = new Set(spaceList.map(s => s.key));
        const seenContributorKeys = new Set(contributorList.map(c => c.key));

        allResults.slice(start - RESULTS_PER_REQUEST, start).forEach(pageData => {
            if (pageData.space && pageData.space.key && pageData.space.name) {
                const spaceKey = pageData.space.key;
                if (!seenSpaceKeys.has(spaceKey)) {
                    seenSpaceKeys.add(spaceKey);
                    const iconUrl = pageData.space.icon?.path ? `${baseUrl}${pageData.space.icon.path}` : `${baseUrl}/images/logo/default-space-logo.svg`;
                    spaceList.push({
                        key: spaceKey,
                        name: pageData.space.name,
                        url: buildConfluenceUrl(pageData.space._links.webui),
                        iconUrl
                    });
                }
                pageData.space.iconUrl = pageData.space.iconUrl || `${baseUrl}${pageData.space.icon?.path || '/images/logo/default-space-logo.svg'}`;
            }

            if (pageData.history && pageData.history.createdBy) {
                const contributor = pageData.history.createdBy;
                const key = contributor.username || contributor.userKey || contributor.accountId;
                if (key && !seenContributorKeys.has(key)) {
                    seenContributorKeys.add(key);
                    let avatarPath = contributor.profilePicture?.path || '/images/icons/profilepics/default.png';
                    contributorList.push({
                        key,
                        name: contributor.displayName,
                        avatarUrl: `${baseUrl}${avatarPath}`
                    });
                    contributor.avatarUrl = `${baseUrl}${avatarPath}`;
                }
            }
        });

        fullSpaceList = [...spaceList];
        fullContributorList = [...contributorList];

        // Sort them
        fullSpaceList.sort((a, b) => a.name.localeCompare(b.name));
        fullContributorList.sort((a, b) => a.name.localeCompare(b.name));

        // Initial display
        displayFilteredSpaceOptions('');
        displayFilteredContributorOptions('');
    }

    function displayFilteredSpaceOptions(filterValue) {
        const spaceOptionsContainer = document.getElementById('space-options');
        spaceOptionsContainer.innerHTML = '';

        const filteredSpaces = fullSpaceList.filter(space => {
            const nameMatch = space.name.toLowerCase().includes(filterValue.toLowerCase());
            const keyMatch = space.key.toLowerCase().includes(filterValue.toLowerCase());
            return nameMatch || keyMatch;
        });

        filteredSpaces.forEach(space => {
            const option = document.createElement('div');
            option.classList.add('option');

            // Add space icon if available, otherwise use Confluence's default icon
            const iconImg = document.createElement('img');
            iconImg.src = space.iconUrl;
            iconImg.loading = 'lazy';
            iconImg.loading = 'lazy';
            iconImg.alt = `${space.name} icon`;
            iconImg.classList.add('space-icon'); // Add a CSS class for styling
            option.appendChild(iconImg);

            // Add space name
            const textNode = document.createTextNode(space.name);
            option.appendChild(textNode);

            // Set additional attributes
            option.title = space.name; // Show full name on hover
            option.dataset.key = space.key;

            // Append to container
            spaceOptionsContainer.appendChild(option);
        });

        addOptionListeners(spaceOptionsContainer, 'space-filter', 'space-options');
    }

    function displayFilteredContributorOptions(filterValue) {
        const contributorOptionsContainer = document.getElementById('contributor-options');
        contributorOptionsContainer.innerHTML = '';

        const filteredContributors = fullContributorList.filter(contributor => {
            const nameMatch = contributor.name.toLowerCase().includes(filterValue.toLowerCase());
            const keyMatch = contributor.key.toLowerCase().includes(filterValue.toLowerCase());
            return nameMatch || keyMatch;
        });

        filteredContributors.forEach(contributor => {
            const option = document.createElement('div');
            option.classList.add('option');

            const img = document.createElement('img');
            img.src = contributor.avatarUrl;
            img.alt = `${contributor.name}'s avatar`;
            img.classList.add('contributor-avatar');
            option.appendChild(img);

            const nameText = contributor.name || contributor.key || 'Unknown';
            const textNode = document.createTextNode(nameText);
            option.appendChild(textNode);

            option.title = nameText;
            option.dataset.key = contributor.key;
            contributorOptionsContainer.appendChild(option);
        });

        addOptionListeners(contributorOptionsContainer, 'contributor-filter', 'contributor-options');
    }

    function addOptionListeners(container, inputId) {
        container.querySelectorAll('.option').forEach(option => {
            option.addEventListener('click', () => {
                const input = document.getElementById(inputId);
                input.value = option.textContent;
                input.dataset.key = option.dataset.key;
                container.style.display = 'none';

                const clearIcon = document.getElementById(
                    inputId === 'space-filter' ? 'space-clear' :
                        inputId === 'contributor-filter' ? 'contributor-clear' :
                            null
                );
                if (clearIcon) toggleClearIcon(input, clearIcon);

                resetDataAndFetchResults();
            });
        });
    }

    let lastTextFilter = '';
    let lastSpaceKey = '';
    let lastContributorKey = '';

    function filterResults(force = false) {
        const textFilterValue = document.getElementById('text-filter').value.toLowerCase();
        const spaceKey = document.getElementById('space-filter').dataset.key || '';
        const contributorKey = document.getElementById('contributor-filter').dataset.key || '';

        // Short-circuit if no change
        if (
            !force &&
            textFilterValue === lastTextFilter &&
            spaceKey === lastSpaceKey &&
            contributorKey === lastContributorKey
        ) {
            return;
        }

        lastTextFilter = textFilterValue;
        lastSpaceKey = spaceKey;
        lastContributorKey = contributorKey;

        filteredResults = allResults.filter(pageData => {
            const matchesText = !textFilterValue || pageData.title.toLowerCase().includes(textFilterValue);
            const matchesSpace = !spaceKey || pageData.space?.key === spaceKey;
            const matchesContributor = !contributorKey || (
                pageData.history?.createdBy &&
                (pageData.history.createdBy.username === contributorKey ||
                    pageData.history.createdBy.userKey === contributorKey ||
                    pageData.history.createdBy.accountId === contributorKey)
            );
            return matchesText && matchesSpace && matchesContributor;
        });

        if (currentSortColumn && currentSortOrder) {
            sortResults(currentSortColumn, currentSortOrder);
        }

        if (filteredResults.length === 0) {
            showNoResultsMessage();
        } else {
            updateTableHtml(filteredResults);
            updateSortIcons();
            updateTreeHtml(filteredResults);
            addEventListeners();
        }
    }

    function sortResults(column, order) {
        filteredResults.sort((a, b) => {
            let valA, valB;
            switch (column) {
                case 'Type': {
                    const labelMap = {
                        page: 'Page',
                        blogpost: 'Blog Post',
                        comment: 'Comment',
                        attachment: 'Attachment'
                    };
                    valA = labelMap[a.type] || a.type || '';
                    valB = labelMap[b.type] || b.type || '';
                    break;
                }
                case 'Name':
                    valA = a.title.toLowerCase();
                    valB = b.title.toLowerCase();
                    break;
                case 'Space':
                    valA = a.space ? a.space.name.toLowerCase() : '';
                    valB = b.space ? b.space.name.toLowerCase() : '';
                    break;
                case 'Contributor':
                    valA = (a.history && a.history.createdBy)
                        ? a.history.createdBy.displayName.toLowerCase()
                        : '';
                    valB = (b.history && b.history.createdBy)
                        ? b.history.createdBy.displayName.toLowerCase()
                        : '';
                    break;
                case 'Date Created':
                    valA = (a.history && a.history.createdDate)
                        ? new Date(a.history.createdDate)
                        : new Date(0);
                    valB = (b.history && b.history.createdDate)
                        ? new Date(b.history.createdDate)
                        : new Date(0);
                    break;
                case 'Last Modified':
                    valA = (a.version && a.version.when)
                        ? new Date(a.version.when)
                        : new Date(0);
                    valB = (b.version && b.version.when)
                        ? new Date(b.version.when)
                        : new Date(0);
                    break;
                default:
                    return 0;
            }
            if (valA < valB) return order === 'asc' ? -1 : 1;
            if (valA > valB) return order === 'asc' ? 1 : -1;
            return 0;
        });
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
        roots = [];

        for (const pageData of results) {
            if (pageData.ancestors) {
                for (const ancestor of pageData.ancestors) {
                    const id = ancestor.id;
                    if (!nodeMap[id]) {
                        nodeMap[id] = {
                            id,
                            title: ancestor.title,
                            url: buildConfluenceUrl(ancestor._links.webui),
                            children: [],
                            isSearchResult: false,
                            expanded: true
                        };
                    }
                }
            }
            const id = pageData.id;
            if (!nodeMap[id]) {
                nodeMap[id] = {
                    id,
                    title: pageData.title,
                    url: buildConfluenceUrl(pageData._links.webui),
                    children: [],
                    isSearchResult: true,
                    expanded: true,
                    contributor: pageData.history?.createdBy?.displayName || 'Unknown',
                    modified: pageData.version?.when ? formatDate(pageData.version.when) : 'N/A',
                    type: pageData.type || 'page'
                };
            }
        }

        for (const pageData of results) {
            const ancestors = pageData.ancestors || [];
            const pageNode = nodeMap[pageData.id];
            if (ancestors.length > 0) {
                let parentNode = null;
                for (const ancestor of ancestors) {
                    const ancestorNode = nodeMap[ancestor.id];
                    if (parentNode && !parentNode.children.includes(ancestorNode)) {
                        parentNode.children.push(ancestorNode);
                    }
                    parentNode = ancestorNode;
                }
                if (parentNode && !parentNode.children.includes(pageNode)) {
                    parentNode.children.push(pageNode);
                }
                const rootAncestorNode = nodeMap[ancestors[0].id];
                if (!roots.includes(rootAncestorNode)) {
                    roots.push(rootAncestorNode);
                }
            } else {
                if (!roots.includes(pageNode)) {
                    roots.push(pageNode);
                }
            }
        }

        const treeContainer = document.getElementById('tree-container');
        log.debug(`Rendering tree with ${roots.length} top-level nodes`);
        treeContainer.innerHTML = generateTreeHtml(roots);

        let tooltip = document.getElementById('tree-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'tree-tooltip';
            tooltip.className = 'tree-tooltip';
            document.body.appendChild(tooltip);
        }

        chrome.storage.sync.get(['showTooltips'], (data) => {
            tooltipSettings.showTooltips = data.showTooltips !== false;
            log.debug('Tooltip feature enabled:', tooltipSettings.showTooltips);
            detachTooltipListeners();
            if (tooltipSettings.showTooltips) {
                attachTooltipListeners();
            }
        });
    }

    function generateTreeHtml(nodes) {
        let html = '<ul>';
        for (const node of nodes) {
            const nodeClass = node.isSearchResult ? 'search-result' : 'ancestor';
            const hasChildren = node.children.length > 0;
            const currentNodeId = `node-${node.id}`;
            const isCollapsed = collapsedNodes.has(currentNodeId);
            const arrow = hasChildren
                ? `<span class="arrow ${isCollapsed ? 'collapsed' : 'expanded'}"></span>`
                : '<span class="arrow empty"></span>';

            const tooltipAttrs = node.isSearchResult
                ? ` data-title="${escapeHtml(node.title)}" data-contributor="${escapeHtml(node.contributor)}" data-modified="${escapeHtml(node.modified)}" data-type="${node.type}"`
                : '';

            html += `<li id="${currentNodeId}" class="${nodeClass}"${tooltipAttrs}>`;
            let icon = '';
            switch (node.type) {
                case 'page': icon = '📘'; break;
                case 'blogpost': icon = '📝'; break;
                case 'comment': icon = '💬'; break;
                case 'attachment': icon = '📎'; break;
            }
            html += `${arrow} <a href="${node.url}" class="tree-node" target="_blank">${icon}&nbsp;&nbsp;${node.title || ''}</a>`;
            if (node.isSearchResult && window.ENABLE_SUMMARIES) {
                const cached = summaryCache.has(node.id);
                const btnText = cached ? '✅ Summary Available!' : '🧠 Summarize';
                html += `<div><button class="summarize-button" data-id="${node.id}">${btnText}</button></div>`;
            }
            if (hasChildren) {
                const displayStyle = collapsedNodes.has(currentNodeId) ? 'none' : 'block';
                html += `<div class="children" style="display: ${displayStyle};">`;
                html += generateTreeHtml(node.children);
                html += '</div>';
            }
            html += '</li>';
        }
        html += '</ul>';
        return html;
    }

    function updateSortIcons() {
        document.querySelectorAll('#table-container th').forEach(th => {
            const icon = th.querySelector('.sort-icon');
            const col = th.getAttribute('data-column');
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
        const container = document.getElementById('table-container');
        log.debug('[Table] Clearing container content');
        container.innerHTML = ''; // Clear previous content

        const table = document.createElement('table');
        const colGroup = document.createElement('colgroup');
        const [col1, col2, col3, col4, col5, col6] =
            Array.from({ length: 6 }, () => document.createElement('col'));
        [col1, col2, col3, col4, col5, col6].forEach(col => colGroup.appendChild(col));
        table.appendChild(colGroup);

        /* ── restore user-resized widths (if any) ─────────────────────────── */
        if (Array.isArray(window.colWidths) && window.colWidths.length) {
            window.colWidths.forEach((w, idx) => {
                if (colGroup.children[idx]) colGroup.children[idx].style.width = w + 'px';
            });
            const total = window.colWidths.reduce((a, b) => a + b, 0);
            table.style.width = total + 'px';         // side-scroll works instantly
        } else {
            /* first render → apply sensible default widths and persist them */
            // share the defaults so the resizer can reset to them
            window.defaultColWidths = DEFAULT_COL_WIDTHS;
            window.colWidths = DEFAULT_COL_WIDTHS.slice();
            DEFAULT_COL_WIDTHS.forEach((w, idx) => {
                if (colGroup.children[idx]) colGroup.children[idx].style.width = w + 'px';
            });
            table.style.width = DEFAULT_COL_WIDTHS.reduce((a, b) => a + b, 0) + 'px';
        }
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');

        const headers = ['Type', 'Name', 'Space', 'Contributor', 'Date Created', 'Last Modified'];
        const colElements = [col1, col2, col3, col4, col5, col6];   // keep order in sync!

        headers.forEach((headerText, idx) => {
            const th = document.createElement('th');
            const label = document.createElement('span');
            label.textContent = headerText;
            th.appendChild(label);

            const sortIcon = document.createElement('span');
            sortIcon.className = 'sort-icon';
            sortIcon.textContent = ''; // Ensure it starts empty
            sortIcon.style.marginLeft = '4px';
            th.appendChild(sortIcon);
            th.setAttribute('data-column', headerText);
            th.style.cursor = 'pointer';

            // Sort unless the user grabbed the resizer
            th.addEventListener('click', (e) => {
                if (e.target.classList.contains('th-resizer')) return;
                const column = e.currentTarget.getAttribute('data-column');

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
            });

            /* ---------- resizer handle ---------- */
            const resizer = document.createElement('span');
            resizer.className = 'th-resizer';
            th.appendChild(resizer);
            attachColResizer(resizer, colElements[idx]);
            /* ------------------------------------ */

            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);
        updateSortIcons();

        const tbody = document.createElement('tbody');

        results.forEach(page => {
            const row = document.createElement('tr');

            // Type
            const typeCell = document.createElement('td');
            const type = page.type || 'page';
            const typeIcon = typeIcons[type] || '';
            const label = typeLabels[type] || type;

            const typeSpan = document.createElement('span');
            typeSpan.textContent = typeIcon;
            typeSpan.style.fontSize = '2.0em';
            typeSpan.title = label;
            typeCell.appendChild(typeSpan);
            row.appendChild(typeCell);

            // Page Name with summary button
            const nameCell = document.createElement('td');
            const nameLink = document.createElement('a');
            nameLink.href = buildConfluenceUrl(page._links.webui);
            nameLink.target = '_blank';
            const fullTitle = page.title || 'Untitled';
            nameLink.classList.add('multiline-ellipsis');
            nameLink.textContent = fullTitle;
            nameLink.title = fullTitle;

            const summaryBtn = document.createElement('button');
            summaryBtn.className = 'summarize-button';
            summaryBtn.dataset.id = page.id;
            summaryBtn.textContent = summaryCache.has(page.id) ? '✅ Summary Available!' : '🧠 Summarize';

            if (!window.ENABLE_SUMMARIES) {
                summaryBtn.style.display = 'none';
            }

            const wrapper = document.createElement('div');
            wrapper.style.display = 'flex';
            wrapper.style.flexDirection = 'column';
            wrapper.style.alignItems = 'flex-start';
            wrapper.appendChild(nameLink);
            wrapper.appendChild(summaryBtn);

            nameCell.appendChild(wrapper);
            row.appendChild(nameCell);

            // Page Space
            const spaceCell = document.createElement('td');
            if (page.space && page.space.name) {
                const spaceContainer = document.createElement('div');
                spaceContainer.classList.add('space-cell');

                // Add space icon if available, otherwise use Confluence's default icon
                const iconImg = document.createElement('img');
                iconImg.src = page.space.iconUrl || `${baseUrl}/images/logo/default-space-logo.svg`;
                iconImg.alt = `${page.space.name} icon`;
                iconImg.classList.add('space-icon'); // Add a CSS class for styling
                spaceContainer.appendChild(iconImg);

                // Add space name
                const spaceLink = document.createElement('a');
                spaceLink.href = buildConfluenceUrl(page.space._links?.webui);
                spaceLink.target = '_blank';
                const spaceSpan = document.createElement('span');
                spaceLink.classList.add('multiline-ellipsis');
                spaceSpan.textContent = page.space.name;
                spaceSpan.title = page.space.name;
                spaceLink.appendChild(spaceSpan);
                spaceContainer.appendChild(spaceLink);
                spaceCell.appendChild(spaceContainer);
            }
            row.appendChild(spaceCell);

            // Contributor
            const contributorCell = document.createElement('td');
            const contributor = page.history?.createdBy;
            if (contributor) {
                const container = document.createElement('div');
                container.classList.add('contributor-cell');

                const avatarImg = document.createElement('img');
                const avatarToUse = contributor.avatarUrl || `${baseUrl}/images/icons/profilepics/default.png`;
                avatarImg.src = avatarToUse;
                avatarImg.loading = 'lazy';
                avatarImg.alt = `${contributor.displayName}'s avatar`;
                avatarImg.classList.add('contributor-avatar');
                container.appendChild(avatarImg);

                const nameLink = document.createElement('a');
                let contributorUrl = '#';
                if (contributor.username) {
                    contributorUrl = `${baseUrl}/display/~${contributor.username}`;
                } else if (contributor.userKey) {
                    contributorUrl = `${baseUrl}/display/~${contributor.userKey}`;
                } else if (contributor.accountId) {
                    contributorUrl = `${baseUrl}/display/~${contributor.accountId}`;
                }
                nameLink.href = contributorUrl;
                nameLink.target = '_blank';
                nameLink.classList.add('multiline-ellipsis');

                const nameSpan = document.createElement('span');
                let contributorName = contributor.displayName || '';
                if (contributorName.startsWith('Unknown User')) {
                    contributorName = contributor.username || contributor.userKey || contributor.accountId || 'Unknown';
                }
                nameSpan.textContent = contributorName;
                nameSpan.title = contributorName;
                nameLink.appendChild(nameSpan);

                container.appendChild(nameLink);
                contributorCell.appendChild(container);
            } else {
                contributorCell.textContent = 'Unknown';
            }
            row.appendChild(contributorCell);

            // Date Created
            const createdCell = document.createElement('td');
            createdCell.textContent =
                page.history?.createdDate ? formatDate(page.history.createdDate) : 'N/A';
            row.appendChild(createdCell);

            // Last Modified
            const modifiedCell = document.createElement('td');
            modifiedCell.textContent =
                page.version?.when ? formatDate(page.version.when) : 'N/A';
            row.appendChild(modifiedCell);

            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        container.appendChild(table);
    }

    function attachColResizer(resizerEl, colEl, minWidth = 60) {
        if (!window.colWidths) window.colWidths = [];

        const tableEl = colEl.closest('table');
        const colIndex = () =>
            Array.from(colEl.parentElement.children).indexOf(colEl);

        /* helper – persist widths & keep table overflowable */
        /* keep the other columns at their stored width so they don’t get squashed */
        const syncTableWidth = () => {
            tableEl.querySelectorAll('col').forEach((c, i) => {
                c.style.width = `${window.colWidths[i]}px`;
            });
            tableEl.style.width =
                window.colWidths.reduce((a, b) => a + b, 0) + 'px';
        };

        /* ── drag to resize ─────────────────────────────────── */
        let startX, startW;
        resizerEl.addEventListener('pointerdown', e => {
            e.preventDefault(); e.stopPropagation();
            startX = e.clientX;
            startW = parseFloat(colEl.style.width) || colEl.getBoundingClientRect().width;

            /* snapshot current widths so the other columns stay put while dragging */
            window.colWidths = Array.from(tableEl.querySelectorAll('col')).map(c =>
                Math.max(
                    parseFloat(c.style.width) || c.getBoundingClientRect().width,
                    minWidth
                )
            );
            const columnIdx = colIndex();

            const move = ev => {
                const w = Math.max(startW + ev.clientX - startX, minWidth);
                window.colWidths[columnIdx] = w;      // change only the dragged column
                syncTableWidth();
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

        /* ── double-click behaviour ───────────────────────────────
            • plain dbl-click  → reset to DEFAULT_COL_WIDTHS[idx]
            • Alt + dbl-click → auto-fit to widest cell (old feature)
        ---------------------------------------------------------------- */
        resizerEl.addEventListener('dblclick', e => {
            e.preventDefault(); e.stopPropagation();
            const idx = colIndex();

            if (e.altKey) {                     // keep the old auto-fit
                let max = 0;

                const th = tableEl.querySelectorAll('thead tr th')[idx];
                if (th) max = th.scrollWidth;

                tableEl.querySelectorAll('tbody tr').forEach(row => {
                    const cell = row.children[idx];
                    if (cell) max = Math.max(max, cell.scrollWidth);
                });

                const padding = 24;
                window.colWidths[idx] = Math.max(max + padding, minWidth);
            } else {                            // restore default width
                const def = (window.defaultColWidths || DEFAULT_COL_WIDTHS)[idx] || minWidth;
                window.colWidths[idx] = def;
            }

            colEl.style.width = window.colWidths[idx] + 'px';
            syncTableWidth();
        });
    }

    function showNoResultsMessage() {
        const message = '<p>No results found.</p>';
        document.getElementById('tree-container').innerHTML = message;
        document.getElementById('table-container').innerHTML = message;
    }

    function showLoadingIndicator(show) {
        const indicator = document.getElementById('loading-indicator');
        indicator.style.display = show ? 'block' : 'none';
    }

    /**
     * ========== EVENT HANDLERS ==========
     */

    // Helper to show/hide clear icons
    function toggleClearIcon(inputElem, clearIcon) {
        clearIcon.style.display = inputElem.value ? 'inline' : 'none';
    }

    function onTypeFilterChange() {
        log.debug('[Filter] Type changed:', typeFilter.value);
        resetDataAndFetchResults();
    }

    function onDateFilterChange() {
        log.debug('[Filter] Date changed:', dateFilter.value);
        resetDataAndFetchResults();
    }

    function addEventListeners() {
        // 1) Tree arrows (expand/collapse)
        const treeContainer = document.getElementById('tree-container');
        const existing = treeContainer._clickHandler;
        if (existing) treeContainer.removeEventListener('click', existing);

        const handler = event => {
            const arrow = event.target.closest('.arrow');
            if (!arrow) return;

            const li = arrow.closest('li');
            const childrenDiv = li?.querySelector('.children');
            if (!childrenDiv) return;

            if (childrenDiv.style.display === 'none') {
                childrenDiv.style.display = 'block';
                arrow.classList.remove('collapsed');
                arrow.classList.add('expanded');
            } else {
                childrenDiv.style.display = 'none';
                arrow.classList.remove('expanded');
                arrow.classList.add('collapsed');
            }
        };

        treeContainer._clickHandler = handler;
        treeContainer.addEventListener('click', handler);

        // 3) Tree/Table view buttons
        const treeViewBtn = document.getElementById('tree-view-btn');
        const tableViewBtn = document.getElementById('table-view-btn');
        treeViewBtn.removeEventListener('click', switchToTreeView);
        treeViewBtn.addEventListener('click', switchToTreeView);
        tableViewBtn.removeEventListener('click', switchToTableView);
        tableViewBtn.addEventListener('click', switchToTableView);

        // 4) Filters (text, space, contributor)
        const textFilter = document.getElementById('text-filter');
        textFilter.removeEventListener('input', filterResults);
        const debouncedFilterResults = debounce(filterResults, 250);
        textFilter.addEventListener('input', (evt) => {
            log.debug('[Filter] Text input changed:', evt.target.value);
            debouncedFilterResults();
        });

        const spaceFilter = document.getElementById('space-filter');
        const contributorFilter = document.getElementById('contributor-filter');

        dateFilter.removeEventListener('change', onDateFilterChange);
        dateFilter.addEventListener('change', onDateFilterChange);

        typeFilter.removeEventListener('change', onTypeFilterChange);
        typeFilter.addEventListener('change', onTypeFilterChange);

        spaceFilter.addEventListener('input', evt => {
            log.debug('[Filter] Space input changed:', evt.target.value);
            if (!isValidInput(evt.target.value)) {
                alert('Invalid input. Please use only alphanumeric characters, spaces, and -_.@');
                evt.target.value = '';
            } else {
                evt.target.value = sanitizeInput(evt.target.value);
            }
            displayFilteredSpaceOptions(evt.target.value);
            document.getElementById('space-options').style.display = 'block';
        });

        contributorFilter.addEventListener('input', evt => {
            log.debug('[Filter] Contributor input changed:', evt.target.value);
            if (!isValidInput(evt.target.value)) {
                alert('Invalid input. Please use only alphanumeric characters, spaces, and -_.@');
                evt.target.value = '';
            } else {
                evt.target.value = sanitizeInput(evt.target.value);
            }
            displayFilteredContributorOptions(evt.target.value);
            document.getElementById('contributor-options').style.display = 'block';
        });

        // Show options on focus
        spaceFilter.addEventListener('focus', evt => {
            displayFilteredSpaceOptions(evt.target.value);
            document.getElementById('space-options').style.display = 'block';
        });
        contributorFilter.addEventListener('focus', evt => {
            displayFilteredContributorOptions(evt.target.value);
            document.getElementById('contributor-options').style.display = 'block';
        });

        // Clear icons
        const spaceClear = document.getElementById('space-clear');
        if (spaceClear && spaceFilter) {
            spaceFilter.addEventListener('input', () => {
                toggleClearIcon(spaceFilter, spaceClear);
            });
            toggleClearIcon(spaceFilter, spaceClear);

            spaceClear.removeEventListener('click', clearSpaceFilter);
            spaceClear.addEventListener('click', clearSpaceFilter);
        }

        const contributorClear = document.getElementById('contributor-clear');
        if (contributorClear && contributorFilter) {
            contributorFilter.addEventListener('input', () => {
                toggleClearIcon(contributorFilter, contributorClear);
            });
            toggleClearIcon(contributorFilter, contributorClear);

            contributorClear.removeEventListener('click', clearContributorFilter);
            contributorClear.addEventListener('click', clearContributorFilter);
        }

        // Close filter options on clicking outside
        document.addEventListener('click', evt => {
            if (!evt.target.closest('#space-filter-container')) {
                document.getElementById('space-options').style.display = 'none';
            }
            if (!evt.target.closest('#contributor-filter-container')) {
                document.getElementById('contributor-options').style.display = 'none';
            }
        });

        // Text filter clear icon
        const textFilterClear = document.getElementById('filter-text-clear');
        if (textFilter && textFilterClear) {
            textFilter.addEventListener('input', () => {
                toggleClearIcon(textFilter, textFilterClear);
            });
            textFilterClear.addEventListener('click', (evt) => {
                log.debug('[Filter] Text filter cleared');
                evt.stopPropagation();
                textFilter.value = '';
                toggleClearIcon(textFilter, textFilterClear);
                filterResults();
                textFilter.focus();
            });
            toggleClearIcon(textFilter, textFilterClear);
        }
    }

    function switchToTreeView() {
        const treeBtn = document.getElementById('tree-view-btn');
        const isTreeActive = treeBtn.classList.contains('active');

        if (isTreeActive) {
            const childrenDivs = document.querySelectorAll('.children');
            const arrows = document.querySelectorAll('.arrow');

            if (allExpanded) {
                childrenDivs.forEach(div => div.style.display = 'none');
                arrows.forEach(arrow => {
                    arrow.classList.remove('expanded');
                    arrow.classList.add('collapsed');
                });
                allExpanded = false;
            } else {
                childrenDivs.forEach(div => div.style.display = 'block');
                arrows.forEach(arrow => {
                    arrow.classList.remove('collapsed');
                    arrow.classList.add('expanded');
                });
                allExpanded = true;
            }
        } else {
            document.getElementById('tree-container').style.display = 'block';
            document.getElementById('table-container').style.display = 'none';
            treeBtn.classList.add('active');
            document.getElementById('table-view-btn').classList.remove('active');
            allExpanded = true; // expanded by default when switching to tree
        }
    }

    function switchToTableView() {
        document.getElementById('tree-container').style.display = 'none';
        document.getElementById('table-container').style.display = 'block';
        document.getElementById('tree-view-btn').classList.remove('active');
        document.getElementById('table-view-btn').classList.add('active');
    }

    function clearSpaceFilter(evt) {
        log.debug('[Filter] Space filter cleared');
        evt.stopPropagation();
        const spaceFilter = document.getElementById('space-filter');
        const spaceClear = document.getElementById('space-clear');
        spaceFilter.value = '';
        spaceFilter.dataset.key = '';
        toggleClearIcon(spaceFilter, spaceClear);
        displayFilteredSpaceOptions('');
        resetDataAndFetchResults();
    }

    function clearContributorFilter(evt) {
        log.debug('[Filter] Contributor filter cleared');
        evt.stopPropagation();
        const contributorFilter = document.getElementById('contributor-filter');
        const contributorClear = document.getElementById('contributor-clear');
        contributorFilter.value = '';
        contributorFilter.dataset.key = '';
        toggleClearIcon(contributorFilter, contributorClear);
        displayFilteredContributorOptions('');
        resetDataAndFetchResults();
    }

    /**
     * ========== INFINITE SCROLL & SCROLL-TO-TOP ==========
     */

    function infiniteScrollHandler() {
        const container = document.querySelector('.container');
        if (!container || !SCROLL_THRESHOLD_REACHED(container)) return;
        loadMoreResults();
    }
    document.querySelector('.container')?.addEventListener('scroll', infiniteScrollHandler);
    document.querySelector('.main-content')?.addEventListener('scroll', infiniteScrollHandler);

    const scrollToTopButton = document.getElementById('scroll-to-top');
    scrollToTopButton.addEventListener('click', () => {
        const scrollableContainer = document.querySelector('.container');
        if (scrollableContainer) {
            scrollableContainer.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });
    // Show or hide Scroll to Top button
    const scrollableContainer = document.querySelector('.container');
    if (scrollableContainer) {
        scrollableContainer.addEventListener('scroll', () => {
            scrollToTopButton.style.display = (scrollableContainer.scrollTop > 200) ? 'block' : 'none';
        });
    }

    /**
     * ========== INITIALIZATION (RUN ON DOM READY) ==========
     */
    const typeFilter = document.getElementById('type-filter');
    const dateFilter = document.getElementById('date-filter');

    // Parse query params
    const params = getQueryParams();
    searchText = params.searchText || '';
    if (!searchText) {
        log.warn('No searchText parameter received in results URL');
    }
    baseUrl = sanitiseBaseUrl(params.baseUrl || '');

    // Derive domain name from baseUrl
    try {
        domainName = new URL(baseUrl).hostname;
    } catch (e) {
        console.error('Invalid baseUrl:', baseUrl);
    }

    // Update document title
    document.title = `Search results for '${escapeHtml(searchText)}' on ${domainName}`;
    // Update page header
    const pageTitleElem = document.getElementById('page-title');
    if (pageTitleElem) {
        pageTitleElem.textContent = `Enhanced Search Results for Confluence (${domainName})`;
    }

    // Load user preferences
    chrome.storage.sync.get(['darkMode', 'resultsPerRequest', 'enableSummaries', 'openaiApiKey'], (data) => {
        const isDark = Boolean(data.darkMode);
        if (data.resultsPerRequest && Number.isInteger(data.resultsPerRequest)) {
            RESULTS_PER_REQUEST = data.resultsPerRequest;
            log.debug('RESULTS_PER_REQUEST set from storage:', RESULTS_PER_REQUEST);
        } else {
            log.debug('Using default RESULTS_PER_REQUEST:', RESULTS_PER_REQUEST);
        }

        document.body.classList.toggle('dark-mode', isDark);

        window.ENABLE_SUMMARIES = data.enableSummaries !== false && !!data.openaiApiKey;

        if (searchText) {
            performNewSearch(searchText);
        }
    });

    // React to darkMode setting changes from other parts of the extension
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync') {
            if (changes.darkMode) {
                document.body.classList.toggle('dark-mode', changes.darkMode.newValue);
            }
            if (changes.showTooltips) {
                tooltipSettings.showTooltips = changes.showTooltips.newValue !== false;
                if (tooltipSettings.showTooltips) {
                    attachTooltipListeners();
                } else {
                    detachTooltipListeners();
                }
            }

            if ('enableSummaries' in changes || 'openaiApiKey' in changes) {
                chrome.storage.sync.get(['enableSummaries', 'openaiApiKey'], (data) => {
                    const enabled = data.enableSummaries === true && !!data.openaiApiKey;
                    window.ENABLE_SUMMARIES = enabled;

                    // Re-render to apply summary button visibility
                    updateTableHtml(filteredResults);
                    updateTreeHtml(filteredResults);
                    addEventListeners();
                });
            }
        }
    });

    // New search elements
    const newSearchInput = document.getElementById('new-search-input');
    const newSearchButton = document.getElementById('new-search-button');
    const mainSearchClear = document.getElementById('main-search-clear');

    if (newSearchInput && newSearchButton && mainSearchClear) {
        newSearchInput.value = searchText;
        toggleClearIcon(newSearchInput, mainSearchClear);

        newSearchInput.addEventListener('input', () => {
            toggleClearIcon(newSearchInput, mainSearchClear);
        });

        newSearchInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                performNewSearch(newSearchInput.value.trim());
            }
        });

        newSearchButton.addEventListener('click', () => {
            performNewSearch(newSearchInput.value.trim());
        });

        mainSearchClear.addEventListener('click', () => {
            newSearchInput.value = '';
            toggleClearIcon(newSearchInput, mainSearchClear);
            newSearchInput.focus();
        });
    }

    // By default, show tree container
    document.getElementById('tree-container').style.display = 'block';

    // Perform initial search if we have searchText
    if (searchText) {
        performNewSearch(searchText);
    }

    const optionsBtn = document.getElementById('open-options');
    if (optionsBtn) {
        optionsBtn.addEventListener('click', () => {
            if (chrome.runtime.openOptionsPage) {
                chrome.runtime.openOptionsPage();
            } else {
                window.open(chrome.runtime.getURL('options/options.html'));
            }
        });
    }

    async function fetchConfluenceBodyById(contentId) {
        if (confluenceBodyCache.has(contentId)) {
            log.debug(`[Cache] Returning cached body for contentId: ${contentId}`);
            return confluenceBodyCache.get(contentId);
        }

        const apiUrl = `${baseUrl}/rest/api/content/${contentId}?expand=body.storage`;
        try {
            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch body: ${response.statusText}`);
            }

            const data = await response.json();
            const bodyHtml = data.body?.storage?.value || '(No content)';
            confluenceBodyCache.set(contentId, bodyHtml);
            log.debug(`[Cache] Fetched and cached body for contentId: ${contentId}`);
            return bodyHtml;
        } catch (error) {
            console.error('[DEBUG] Error in fetchConfluenceBodyById:', error);
            throw error;
        }
    }

    // Handle summarize button clicks (tree and table view)
    document.body.addEventListener('click', async (e) => {
        const btn = e.target.closest('.summarize-button');
        if (!btn) return;

        const contentId = btn.dataset.id;
        const allButtons = document.querySelectorAll(`.summarize-button[data-id="${contentId}"]`);
        const pageData = allResults.find(r => r.id === contentId);
        if (!pageData) {
            console.warn('Content not found for summarization');
            return;
        }

        allButtons.forEach(b => {
            b.textContent = 'Summarizing...';
            b.classList.add('loading');
            b.disabled = true;
        });

        let bodyHtml = await fetchConfluenceBodyById(contentId);
        bodyHtml = sanitizeHtmlWithDOM(bodyHtml);

        try {
            const stored = await getStoredSummary(contentId, baseUrl);
            if (stored && stored.summaryHtml) {
                log.debug(`[DB] Loaded summary from IndexedDB for contentId: ${contentId}`);
                summaryCache.set(contentId, stored.summaryHtml);
                showSummaryModal(stored.summaryHtml, pageData, bodyHtml);
                resetSummaryButtons(allButtons, '✅ Summary Available!');
                return;
            }

            chrome.storage.sync.get(['openaiApiKey', 'customApiEndpoint'], (syncData) => {
                chrome.storage.local.get(['customUserPrompt'], async () => {
                    const apiKey = syncData.openaiApiKey;
                    if (!apiKey) {
                        alert('OpenAI API key not set. Please enter it in the extension options.');
                        return;
                    }

                    if (stored && stored.summaryHtml) {
                        log.debug(`[DB] Loaded summary from IndexedDB for contentId: ${contentId}`);
                        summaryCache.set(contentId, stored.summaryHtml);
                        showSummaryModal(stored.summaryHtml);
                        resetSummaryButtons(allButtons, '✅ Summary Available!');
                        return;
                    }

                    const userPrompt = await getUserPrompt(pageData);
                    const apiEndpoint = syncData.customApiEndpoint?.trim() || 'https://api.openai.com/v1/chat/completions';
                    const aiModel = 'gpt-4o';

                    log.debug('[Summary] Model:', aiModel);
                    log.debug('[Summary] User prompt length:', userPrompt.length);
                    log.debug('[Summary] System prompt length:', summarySystemPrompt.length);

                    const combinedLength = summarySystemPrompt.length + userPrompt.length;
                    if (combinedLength > 500000) {
                        alert('The content is too large to summarize with the AI model (token limit exceeded). Try summarizing a shorter page.');
                        resetSummaryButtons(allButtons, '🧠 Summarize');
                        return;
                    }

                    try {
                        const result = await sendOpenAIRequest({
                            apiKey,
                            apiUrl: apiEndpoint,
                            model: aiModel,
                            messages: [
                                { role: 'system', content: summarySystemPrompt },
                                { role: 'user', content: userPrompt }
                            ]
                        });

                        const summary = result.choices[0].message.content;
                        summaryCache.set(contentId, summary);
                        await storeSummary({
                            contentId,
                            baseUrl,
                            title: pageData.title,
                            summaryHtml: summary,
                            bodyHtml: bodyHtml
                        });
                        showSummaryModal(summary, pageData, bodyHtml);
                        resetSummaryButtons(allButtons, '✅ Summary Available!');
                    } catch (err) {
                        console.error('[Summary] Error:', err);
                        alert('Failed to get summary from OpenAI. See console for details.');
                        resetSummaryButtons(allButtons, '🧠 Summarize');
                    }
                });
            });
        } catch (e) {
            console.error('[Summary] Failed to summarize content:', e);
            alert('Failed to summarize content. See console for details.');
            resetSummaryButtons(allButtons, '🧠 Summarize');
        }
    });

    async function showSummaryModal(summaryText, pageData, bodyHtml) {
        const modal = document.getElementById('summary-modal');
        const modalBody = document.getElementById('modal-body');
        const closeBtn = document.getElementById('modal-close');

        // Split into paragraphs and list items, detect direction, and wrap
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = summaryText;

        tempDiv.querySelectorAll('p, li, h2, h3, h4, h5, h6').forEach(el => {
            const dir = detectDirection(el.textContent);
            el.setAttribute('dir', dir);
        });

        const summaryDiv = document.createElement('div');
        summaryDiv.id = 'summary-content';
        summaryDiv.innerHTML = tempDiv.innerHTML;

        const summaryTitle = document.getElementById('summary-title');
        if (summaryTitle) {
            const pageUrl = buildConfluenceUrl(pageData._links.webui);
            summaryTitle.innerHTML = `<strong>🧠 AI Summary</strong><br><a href="${pageUrl}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(pageData.title)}">${escapeHtml(pageData.title)}</a>`;
        }

        modalBody.innerHTML = '';

        const summaryAndThreadWrapper = document.createElement('div');
        summaryAndThreadWrapper.id = 'summary-thread-wrapper';
        summaryAndThreadWrapper.style.display = 'flex';
        summaryAndThreadWrapper.style.flexDirection = 'column';
        summaryAndThreadWrapper.style.gap = '12px';

        summaryAndThreadWrapper.appendChild(summaryDiv);

        const qaTitle = document.createElement('h3');
        qaTitle.textContent = '💬 Follow-Up Questions';
        qaTitle.className = 'conversation-title';
        summaryAndThreadWrapper.appendChild(qaTitle);

        const qaThread = document.createElement('div');
        qaThread.id = 'qa-thread';
        summaryAndThreadWrapper.appendChild(qaThread);

        const scrollBtn = document.createElement('button');
        scrollBtn.id = 'qa-scroll-top';
        scrollBtn.textContent = '⬆';
        scrollBtn.title = 'Scroll to summary';
        scrollBtn.style.alignSelf = 'flex-end';
        scrollBtn.style.display = 'none';
        summaryAndThreadWrapper.appendChild(scrollBtn);

        modalBody.appendChild(summaryAndThreadWrapper);

        // Add the input area for follow-up questions
        const modalContent = modal.querySelector('.modal-content');
        const existingInputArea = modalContent.querySelector('#qa-input-area');
        if (existingInputArea) existingInputArea.remove();
        const qaInputArea = document.createElement('div');
        qaInputArea.id = 'qa-input-area';
        qaInputArea.innerHTML = `
            <div class="qa-input-wrapper">
                <div class="textarea-resizer" id="qa-resizer"></div>
                <textarea id="qa-input" placeholder="Ask a follow-up question..."></textarea>
            </div>
            <div class="qa-button-row">
                <button id="qa-submit">❓ Ask A Question</button>
                <button id="qa-resummarize">🧠 Re-summarize</button>
                <button id="qa-clear">🧹 Clear Conversation</button>
            </div>
            <div id="qa-loading" style="display: none;">Answering...</div>
            <div id="resummarize-loading-overlay">
                <div class="loader small-loader"></div>
                Regenerating summary...
            </div>
        `;

        modalContent.appendChild(qaInputArea);

        const qaInput = document.getElementById('qa-input');

        // Restore saved height for qa-input
        const savedHeight = sessionStorage.getItem('qaInputHeight');
        if (savedHeight) {
            qaInput.style.height = `${savedHeight}px`;
        }

        const qaSubmit = document.getElementById('qa-submit');

        const contentId = pageData.id;
        const storedConv = await getStoredConversation(contentId, baseUrl);
        const userPrompt = await getUserPrompt(pageData);
        const conversation = storedConv?.messages || [
            { role: 'system', content: qaSystemPrompt },
            { role: 'user', content: userPrompt },
            { role: 'assistant', content: summaryText }
        ];
        conversationHistories.set(contentId, conversation);
        storeConversation(contentId, baseUrl, conversation);

        // Render the conversation into the DOM (skip system prompt)
        for (const msg of conversation.slice(3)) {
            const div = document.createElement('div');
            div.className = `qa-entry ${msg.role}`;
            const dir = detectDirection(msg.content);
            div.setAttribute('dir', dir);
            div.style.textAlign = dir === 'rtl' ? 'right' : 'left';

            if (msg.role === 'assistant') {
                div.innerHTML = msg.content;
            } else {
                div.textContent = msg.content;
            }

            qaThread.appendChild(div);
        }

        function submitQuestion() {
            const question = qaInput.value.trim();
            if (!question) return;

            const messages = conversationHistories.get(contentId);
            messages.push({ role: 'user', content: question });

            const userMsg = document.createElement('div');
            userMsg.className = 'qa-entry user';
            const userDir = detectDirection(question);
            userMsg.setAttribute('dir', userDir);
            userMsg.style.textAlign = userDir === 'rtl' ? 'right' : 'left';
            userMsg.textContent = question;
            qaThread.appendChild(userMsg);
            qaSubmit.disabled = true;
            // Add typing bubble
            const typingBubble = document.createElement('div');
            typingBubble.className = 'qa-entry assistant typing-bubble';
            typingBubble.innerHTML = `
                <span class="typing-dots">
                    <span class="dot"></span>
                    <span class="dot"></span>
                    <span class="dot"></span>
                </span>
            `;

            const typingDir = detectDirection('...');
            typingBubble.setAttribute('dir', typingDir);
            typingBubble.style.textAlign = typingDir === 'rtl' ? 'right' : 'left';
            qaThread.appendChild(typingBubble);

            const modalBody = document.getElementById('modal-body');
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    modalBody.scrollTo({ top: modalBody.scrollHeight, behavior: 'smooth' });
                });
            });

            qaThread.scrollTop = qaThread.scrollHeight;
            qaInput.value = '';

            chrome.storage.sync.get(['openaiApiKey', 'customApiEndpoint'], async (data) => {
                const apiKey = data.openaiApiKey;
                const endpoint = data.customApiEndpoint?.trim() || 'https://api.openai.com/v1/chat/completions';
                const aiModel = 'gpt-4o';
                try {
                    const result = await sendOpenAIRequest({
                        apiKey,
                        apiUrl: endpoint,
                        model: aiModel,
                        messages
                    });

                    const answer = result.choices?.[0]?.message?.content || '[No response]';
                    messages.push({ role: 'assistant', content: answer });
                    storeConversation(contentId, baseUrl, messages);

                    const reply = document.createElement('div');
                    reply.className = 'qa-entry assistant';
                    const assistantDir = detectDirection(answer);
                    reply.setAttribute('dir', assistantDir);
                    reply.style.textAlign = assistantDir === 'rtl' ? 'right' : 'left';
                    reply.innerHTML = answer;
                    qaThread.appendChild(reply);
                    requestAnimationFrame(() => {
                        reply.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    });

                } catch (err) {
                    console.error('[QA] Error:', err);
                    alert('Failed to get answer from OpenAI.');
                } finally {
                    qaSubmit.disabled = false;
                    const oldTyping = document.querySelector('.typing-bubble');
                    if (oldTyping) oldTyping.remove();
                }
            });
        }

        qaSubmit.onclick = submitQuestion;

        // Custom textarea resizer
        const qaResizer = document.getElementById('qa-resizer');

        // Double-click to reset height
        qaResizer.addEventListener('dblclick', () => {
            qaInput.style.height = '60px';
            sessionStorage.removeItem('qaInputHeight');
        });

        let isResizing = false;
        let startY, startHeight;

        qaResizer.addEventListener('mousedown', e => {
            isResizing = true;
            startY = e.clientY;
            startHeight = parseInt(window.getComputedStyle(qaInput).height, 10);
            document.body.style.cursor = 'ns-resize';
            document.addEventListener('mousemove', resizeMouseMove);
            document.addEventListener('mouseup', stopResize);
        });

        function resizeMouseMove(e) {
            if (!isResizing) return;
            const dy = e.clientY - startY;
            const newHeight = Math.max(60, startHeight - dy);
            qaInput.style.height = `${newHeight}px`;
            sessionStorage.setItem('qaInputHeight', newHeight);
        }

        function stopResize() {
            isResizing = false;
            document.body.style.cursor = '';
            document.removeEventListener('mousemove', resizeMouseMove);
            document.removeEventListener('mouseup', stopResize);
        }

        qaInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitQuestion();

                qaInput.setAttribute('dir', 'ltr');
            }
        });

        // Dynamically update input direction based on text
        qaInput.addEventListener('input', () => {
            const direction = detectDirection(qaInput.value);
            qaInput.setAttribute('dir', direction);
        });

        const qaClear = document.getElementById('qa-clear');
        const qaResummarize = document.getElementById('qa-resummarize');
        const resummarizeOverlay = document.getElementById('resummarize-loading-overlay');

        qaResummarize.onclick = async () => {
            showConfirmationDialog('<b>Are you sure you want to regenerate the summary?</b><br>This will replace the current summary and reset the conversation.', async () => {

                qaSubmit.disabled = true;
                qaClear.disabled = true;
                qaResummarize.disabled = true;
                resummarizeOverlay.style.display = 'flex';

                const allButtons = document.querySelectorAll(`.summarize-button[data-id="${contentId}"]`);
                allButtons.forEach(b => {
                    b.textContent = 'Re-summarizing...';
                    b.classList.add('loading');
                    b.disabled = true;
                });

                await new Promise(requestAnimationFrame); // allow DOM to update

                try {
                    const userPrompt = await getUserPrompt(pageData);
                    const { openaiApiKey: apiKey, customApiEndpoint } = await new Promise(res =>
                        chrome.storage.sync.get(['openaiApiKey', 'customApiEndpoint'], res));
                    const endpoint = customApiEndpoint?.trim() || 'https://api.openai.com/v1/chat/completions';
                    const model = 'gpt-4o';

                    const result = await sendOpenAIRequest({
                        apiKey,
                        apiUrl: endpoint,
                        model,
                        messages: [
                            { role: 'system', content: summarySystemPrompt },
                            { role: 'user', content: userPrompt }
                        ]
                    });

                    const newSummary = result.choices[0].message.content;
                    summaryCache.set(contentId, newSummary);

                    await storeSummary({
                        contentId,
                        baseUrl,
                        title: pageData.title,
                        summaryHtml: newSummary,
                        bodyHtml
                    });

                    const newConversation = [
                        { role: 'system', content: qaSystemPrompt },
                        { role: 'user', content: userPrompt },
                        { role: 'assistant', content: newSummary }
                    ];

                    conversationHistories.set(contentId, newConversation);
                    await storeConversation(contentId, baseUrl, newConversation);

                    resummarizeOverlay.style.display = 'none';
                    showSummaryModal(newSummary, pageData, bodyHtml);
                    resetSummaryButtons(allButtons, '✅ Summary Available!');
                    return;
                } catch (err) {
                    console.error('Re-summarize failed:', err);
                    alert('Failed to regenerate summary.');
                    resummarizeOverlay.style.display = 'none';
                    resetSummaryButtons(allButtons, '🧠 Summarize');
                } finally {
                    qaSubmit.disabled = false;
                    qaClear.disabled = false;
                    qaResummarize.disabled = false;
                }
            });
        };

        scrollBtn.onclick = () => {
            modalBody.scrollTo({ top: 0, behavior: 'smooth' });
        };

        modalBody.addEventListener('scroll', () => {
            scrollBtn.style.display = modalBody.scrollTop > 100 ? 'inline-block' : 'none';
        });

        qaClear.onclick = () => {
            showConfirmationDialog('<b>Are you sure you want to clear this conversation?</b>', () => {
                // Reset conversation to initial state
                const newConversation = [
                    { role: 'system', content: qaSystemPrompt },
                    { role: 'user', content: userPrompt },
                    { role: 'assistant', content: summaryText }
                ];
                conversationHistories.set(contentId, newConversation);
                storeConversation(contentId, baseUrl, newConversation);

                // Clear and re-render conversation thread
                qaThread.innerHTML = '';
                for (const msg of newConversation.slice(3)) {
                    const div = document.createElement('div');
                    div.className = `qa-entry ${msg.role}`;
                    const dir = detectDirection(msg.content);
                    div.setAttribute('dir', dir);
                    div.style.textAlign = dir === 'rtl' ? 'right' : 'left';
                    if (msg.role === 'assistant') {
                        div.innerHTML = msg.content;
                    } else {
                        div.textContent = msg.content;
                    }
                    qaThread.appendChild(div);
                }
            });
        };

        modal.style.display = 'flex';

        // Close on 'x'
        closeBtn.onclick = () => modal.style.display = 'none';

        // Close on click outside
        window.onclick = (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        };

        // Close on ESC
        document.onkeydown = (e) => {
            if (e.key === 'Escape') {
                modal.style.display = 'none';
            }
        };
    }

    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'summariesCleared') {
            summaryCache.clear();
            document.querySelectorAll('.summarize-button').forEach(btn => {
                btn.textContent = '🧠 Summarize';
                btn.classList.remove('loading');
                btn.disabled = false;
            });
            log.debug('[Summaries] Cleared cache and reset summarize buttons.');
        }
    });

    const modal = document.getElementById('resizable-modal');
    const modalResizerRight = document.getElementById('modal-resizer');

    const savedWidth = sessionStorage.getItem('modalWidth');
    if (savedWidth && modal) {
        modal.style.width = `${savedWidth}px`;
    }

    if (modalResizerRight && modal) {
        modalResizerRight.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = modal.offsetWidth;

            const onMouseMove = (moveEvent) => {
                const delta = moveEvent.clientX - startX;
                const newWidth = Math.max(300, startWidth + 2 * delta); // double for symmetric
                modal.style.width = `${newWidth}px`;
                sessionStorage.setItem('modalWidth', newWidth);
            };

            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    modalResizerRight.addEventListener('dblclick', () => {
        modal.style.width = '600px';
        sessionStorage.removeItem('modalWidth');
    });

    const modalResizerLeft = document.getElementById('modal-resizer-left');
    if (modalResizerLeft && modal) {
        modalResizerLeft.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = modal.offsetWidth;

            const onMouseMove = (moveEvent) => {
                const delta = startX - moveEvent.clientX; // Inverse direction
                const newWidth = Math.max(300, startWidth + 2 * delta);
                modal.style.width = `${newWidth}px`;
                sessionStorage.setItem('modalWidth', newWidth);
            };

            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    modalResizerLeft.addEventListener('dblclick', () => {
        modal.style.width = '600px';
        sessionStorage.removeItem('modalWidth');
    });

    // Attach global event listeners
    addEventListeners();
});