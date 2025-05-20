document.addEventListener('DOMContentLoaded', () => {
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

    // Variables for sorting
    let currentSortColumn = '';
    let currentSortOrder = ''; // 'asc', 'desc', or ''

    let tooltipSettings = { showTooltips: true };

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

    /**
     * ========== UTILITY FUNCTIONS ==========
     */

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
        const queryString = window.location.search.substring(1);
        const regex = /([^&=]+)=([^&]*)/g;
        let m;
        while ((m = regex.exec(queryString))) {
            params[decodeURIComponent(m[1])] = decodeURIComponent(m[2]);
        }
        return params;
    }

    function escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
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
            window.colWidths        = DEFAULT_COL_WIDTHS.slice();
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

            // Page Name
            const nameCell = document.createElement('td');
            const nameLink = document.createElement('a');
            nameLink.href = buildConfluenceUrl(page._links.webui);
            nameLink.target = '_blank';
            const fullTitle = page.title || 'Untitled';
            nameLink.classList.add('multiline-ellipsis');
            nameLink.textContent = fullTitle;
            nameLink.title = fullTitle;
            nameCell.appendChild(nameLink);
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
            contributorCell.classList.add('contributor-cell');
            const contributor = page.history?.createdBy;
            if (contributor) {
                const avatarImg = document.createElement('img');
                const avatarToUse = contributor.avatarUrl || `${baseUrl}/images/icons/profilepics/default.png`;
                avatarImg.src = avatarToUse;
                avatarImg.loading = 'lazy';
                avatarImg.loading = 'lazy';
                avatarImg.alt = `${contributor.displayName}'s avatar`;
                avatarImg.classList.add('contributor-avatar');
                contributorCell.appendChild(avatarImg);

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
                const nameSpan = document.createElement('span');
                nameLink.classList.add('multiline-ellipsis');
                let contributorName = contributor.displayName || '';
                if (contributorName.startsWith('Unknown User')) {
                    contributorName = contributor.username || contributor.userKey || contributor.accountId || 'Unknown';
                }
                nameSpan.textContent = contributorName;
                nameSpan.title = contributorName;
                nameLink.appendChild(nameSpan);
                contributorCell.appendChild(nameLink);
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

    function addEventListeners() {
        // 1) Tree arrows (expand/collapse)
        document.getElementById('tree-container').addEventListener('click', event => {
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
        });

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
        const dateFilter = document.getElementById('date-filter');
        const typeFilter = document.getElementById('type-filter');

        dateFilter.addEventListener('change', () => {
            log.debug('[Filter] Date changed:', dateFilter.value);
            resetDataAndFetchResults();
        });

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

    // Parse query params
    const params = getQueryParams();
    searchText = params.searchText || '';
    if (!searchText) {
        log.warn('No searchText parameter received in popup URL');
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
    chrome.storage.sync.get(['darkMode', 'resultsPerRequest'], (data) => {
        const isDark = Boolean(data.darkMode);
        if (data.resultsPerRequest && Number.isInteger(data.resultsPerRequest)) {
            RESULTS_PER_REQUEST = data.resultsPerRequest;
            log.debug('RESULTS_PER_REQUEST set from storage:', RESULTS_PER_REQUEST);
        } else {
            log.debug('Using default RESULTS_PER_REQUEST:', RESULTS_PER_REQUEST);
        }
        document.body.classList.toggle('dark-mode', isDark);

        // 🟢 This guarantees fetch starts only after settings are loaded
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

    // Attach global event listeners
    addEventListeners();
});