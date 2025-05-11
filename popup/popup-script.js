document.addEventListener('DOMContentLoaded', () => {
    /**
     * ========== CONSTANTS & GLOBALS ==========
     */
    const SCROLL_OFFSET = 500;     // magic number previously used for infinite scrolling
    const RESULTS_PER_REQUEST = 50; // magic number for how many results per fetch

    // We’ll use 'let' if a variable’s value changes, and 'const' otherwise.
    let searchText = '';
    let baseUrl = '';
    let domainName = '';

    // Tree/Filtering/Sorting state
    let nodeIdCounter = 0;
    let nodeMap = {};
    let roots = [];
    let searchResultIds = new Set();
    let allExpanded = true;
    let loading = false;
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
    let currentSortOrder = 'asc'; // 'asc' or 'desc'

    // Dark mode
    let isDarkMode = false;

    /**
     * ========== UTILITY FUNCTIONS ==========
     */

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
        // Allow only alphanumeric characters, spaces, and certain special characters
        const regex = /^[a-zA-Z0-9\s\-_.@]*$/;
        return regex.test(input);
    }

    function sanitizeInput(input) {
        // Remove any potentially harmful characters
        return input.replace(/[^a-zA-Z0-9\s\-_.@]/g, '');
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

    /**
     * ========== CORE LOGIC FUNCTIONS ==========
     */

    function buildCQL() {
        const cqlParts = ['type=page'];
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
        return encodeURIComponent(cqlParts.join(' AND '));
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
        document.getElementById('page-title').textContent = `Enhanced Confluence Search Results (${domainName})`;

        searchText = query;
        resetDataAndFetchResults();
    }

    function resetDataAndFetchResults() {
        // Reset variables
        nodeIdCounter = 0;
        nodeMap = {};
        roots = [];
        searchResultIds = new Set();
        allExpanded = true;
        loading = false;
        allResultsLoaded = false;
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
        if (loading || allResultsLoaded) return;
        loading = true;
        showLoadingIndicator(true);

        const cql = buildCQL();
        // Updated search URL to include expand parameter
        const searchUrl = `${baseUrl}/rest/api/content/search?cql=${cql}&limit=${RESULTS_PER_REQUEST}&start=${start}&expand=ancestors,space,history,version`;

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
                allResultsLoaded = true;
                if (allResults.length === 0) {
                    // No results at all
                    showNoResultsMessage();
                }
                showLoadingIndicator(false);
                return;
            }

            start += results.length;

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
            filterResults();

            if (start >= totalSize) {
                allResultsLoaded = true;
            }
        } catch (err) {
            console.error(err);
            alert(`An error occurred: ${err.message}`);
        }
        showLoadingIndicator(false);
        loading = false;
    }

    function updateFilterOptions() {
        spaceList = [];
        contributorList = [];

        allResults.forEach(pageData => {
            // Spaces
            if (pageData.space && pageData.space.key && pageData.space.name) {
                const spaceKey = pageData.space.key;
                if (!spaceList.some(s => s.key === spaceKey)) {
                    spaceList.push({
                        key: spaceKey,
                        name: pageData.space.name,
                        url: buildConfluenceUrl(pageData.space._links.webui)
                    });
                }
            }
            // Contributors (creator)
            if (pageData.history && pageData.history.createdBy) {
                const contributor = pageData.history.createdBy;
                const contributorKey = contributor.username || contributor.userKey || contributor.accountId;
                if (contributorKey && !contributorList.some(c => c.key === contributorKey)) {
                    contributorList.push({
                        key: contributorKey,
                        name: contributor.displayName
                    });
                }
            }
        });

        // Store full lists (for filtering as user types)
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
    
        const filteredSpaces = fullSpaceList.filter(space =>
            space.name.toLowerCase().includes(filterValue.toLowerCase())
        );
    
        filteredSpaces.forEach(space => {
            const option = document.createElement('div');
            option.classList.add('option');
            option.textContent = space.name;
            option.title = space.name; // ✅ Show full name on hover
            option.dataset.key = space.key;
            spaceOptionsContainer.appendChild(option);
        });
    
        addOptionListeners(spaceOptionsContainer, 'space-filter', 'space-options');
    }
    
    function displayFilteredContributorOptions(filterValue) {
        const contributorOptionsContainer = document.getElementById('contributor-options');
        contributorOptionsContainer.innerHTML = '';
    
        const filteredContributors = fullContributorList.filter(contributor =>
            contributor.name.toLowerCase().includes(filterValue.toLowerCase())
        );
    
        filteredContributors.forEach(contributor => {
            const option = document.createElement('div');
            option.classList.add('option');
            option.textContent = contributor.name;
            option.title = contributor.name; // ✅ Show full name on hover
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
                resetDataAndFetchResults();
            });
        });
    }

    function filterResults() {
        const textFilterValue = document.getElementById('text-filter').value.toLowerCase();

        filteredResults = allResults.filter(pageData => {
            if (!textFilterValue) return true;
            const title = pageData.title.toLowerCase();
            return title.includes(textFilterValue);
        });

        // Apply sorting if any
        if (currentSortColumn) {
            sortResults(currentSortColumn, currentSortOrder);
        }

        if (filteredResults.length === 0) {
            showNoResultsMessage();
        } else {
            updateTableHtml(filteredResults);
            updateTreeHtml(filteredResults);
            addEventListeners(); // re-attach to new DOM
        }
    }

    function sortResults(column, order) {
        filteredResults.sort((a, b) => {
            let valA, valB;
            switch (column) {
                case 'Page Name':
                    valA = a.title.toLowerCase();
                    valB = b.title.toLowerCase();
                    break;
                case 'Page Space':
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
        // Clear existing structure
        nodeMap = {};
        roots = [];

        // Build node objects
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
            // Create node for this page
            const id = pageData.id;
            if (!nodeMap[id]) {
                nodeMap[id] = {
                    id,
                    title: pageData.title,
                    url: buildConfluenceUrl(pageData._links.webui),
                    children: [],
                    isSearchResult: true,
                    expanded: true
                };
            }
        }

        // Link up parents/children
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
                // The first ancestor is top-level
                const rootAncestorNode = nodeMap[ancestors[0].id];
                if (!roots.includes(rootAncestorNode)) {
                    roots.push(rootAncestorNode);
                }
            } else {
                // This page has no ancestors => root
                if (!roots.includes(pageNode)) {
                    roots.push(pageNode);
                }
            }
        }

        // Generate Tree HTML
        const treeContainer = document.getElementById('tree-container');
        const treeHtml = generateTreeHtml(roots);
        treeContainer.innerHTML = treeHtml;
    }

    function generateTreeHtml(nodes) {
        let html = '<ul>';
        for (const node of nodes) {
            const nodeClass = node.isSearchResult ? 'search-result' : 'ancestor';
            const hasChildren = node.children.length > 0;
            const currentNodeId = `node-${nodeIdCounter++}`;
            const arrow = hasChildren
                ? '<span class="arrow expanded"></span>'
                : '<span class="arrow empty"></span>';

            html += `<li id="${currentNodeId}" class="${nodeClass}">`;
            html += `${arrow} <a href="${node.url}" target="_blank">${node.title}</a>`;
            if (hasChildren) {
                html += '<div class="children" style="display: block;">';
                html += generateTreeHtml(node.children);
                html += '</div>';
            }
            html += '</li>';
        }
        html += '</ul>';
        return html;
    }

    function updateTableHtml(results) {
        const container = document.getElementById('table-container');
        container.innerHTML = ''; // clear previous

        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');

        const headers = ['Page Name', 'Page Space', 'Contributor', 'Date Created', 'Last Modified'];
        headers.forEach(headerText => {
            const th = document.createElement('th');
            th.textContent = headerText;
            th.setAttribute('data-column', headerText);
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');

        results.forEach(page => {
            const row = document.createElement('tr');

            // Page Name
            const nameCell = document.createElement('td');
            const nameLink = document.createElement('a');
            nameLink.href = buildConfluenceUrl(page._links.webui);
            nameLink.target = '_blank';
            nameLink.textContent = page.title || 'Untitled';
            nameCell.appendChild(nameLink);
            row.appendChild(nameCell);

            // Page Space
            const spaceCell = document.createElement('td');
            if (page.space && page.space.name) {
                if (page.space._links?.webui) {
                    const spaceLink = document.createElement('a');
                    spaceLink.href = buildConfluenceUrl(page.space._links.webui);
                    spaceLink.target = '_blank';
                    spaceLink.textContent = page.space.name;
                    spaceCell.appendChild(spaceLink);
                } else {
                    spaceCell.textContent = page.space.name;
                }
            }
            row.appendChild(spaceCell);

            // Contributor
            const contributorCell = document.createElement('td');
            contributorCell.textContent =
                page.history?.createdBy?.displayName || 'Unknown';
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

    function addEventListeners() {
        // 1) Tree arrows (expand/collapse)
        const arrows = document.querySelectorAll('.arrow');
        arrows.forEach(arrow => {
            if (!arrow.dataset.listenerAdded) {
                arrow.addEventListener('click', event => {
                    const li = event.target.parentElement;
                    const childrenDiv = li.querySelector('.children');
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
                arrow.dataset.listenerAdded = true;
            }
        });

        // 2) Toggle all
        const toggleButton = document.getElementById('toggle-all');
        toggleButton.removeEventListener('click', toggleAllHandler); // remove old before re-adding
        toggleButton.addEventListener('click', toggleAllHandler);

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
        textFilter.addEventListener('input', filterResults);

        const spaceFilter = document.getElementById('space-filter');
        const contributorFilter = document.getElementById('contributor-filter');

        spaceFilter.addEventListener('input', evt => {
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
        spaceClear.removeEventListener('click', clearSpaceFilter);
        spaceClear.addEventListener('click', clearSpaceFilter);

        const contributorClear = document.getElementById('contributor-clear');
        contributorClear.removeEventListener('click', clearContributorFilter);
        contributorClear.addEventListener('click', clearContributorFilter);

        // Close filter options on clicking outside
        document.addEventListener('click', evt => {
            if (!evt.target.closest('#space-filter-container')) {
                document.getElementById('space-options').style.display = 'none';
            }
            if (!evt.target.closest('#contributor-filter-container')) {
                document.getElementById('contributor-options').style.display = 'none';
            }
        });

        // 5) Table Header Sorting
        const tableHeaders = document.querySelectorAll('#table-container th');
        tableHeaders.forEach(header => {
            header.style.cursor = 'pointer';
            header.addEventListener('click', () => {
                const column = header.getAttribute('data-column');
                if (currentSortColumn === column) {
                    currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSortColumn = column;
                    currentSortOrder = 'asc';
                }
                filterResults();
            });
        });
    }

    function toggleAllHandler() {
        const childrenDivs = document.querySelectorAll('.children');
        const arrows = document.querySelectorAll('.arrow');
        const toggleButton = document.getElementById('toggle-all');

        if (allExpanded) {
            // Collapse all
            childrenDivs.forEach(div => {
                div.style.display = 'none';
            });
            arrows.forEach(arrow => {
                arrow.classList.remove('expanded');
                arrow.classList.add('collapsed');
            });
            toggleButton.textContent = 'Expand All';
            allExpanded = false;
        } else {
            // Expand all
            childrenDivs.forEach(div => {
                div.style.display = 'block';
            });
            arrows.forEach(arrow => {
                arrow.classList.remove('collapsed');
                arrow.classList.add('expanded');
            });
            toggleButton.textContent = 'Collapse All';
            allExpanded = true;
        }
    }

    function switchToTreeView() {
        document.getElementById('tree-container').style.display = 'block';
        document.getElementById('table-container').style.display = 'none';
        document.getElementById('tree-view-btn').classList.add('active');
        document.getElementById('table-view-btn').classList.remove('active');
        document.getElementById('toggle-all').style.display = 'inline-block';
    }

    function switchToTableView() {
        document.getElementById('tree-container').style.display = 'none';
        document.getElementById('table-container').style.display = 'block';
        document.getElementById('tree-view-btn').classList.remove('active');
        document.getElementById('table-view-btn').classList.add('active');
        document.getElementById('toggle-all').style.display = 'none';
    }

    function clearSpaceFilter(evt) {
        evt.stopPropagation();
        const spaceFilter = document.getElementById('space-filter');
        spaceFilter.value = '';
        spaceFilter.dataset.key = '';
        displayFilteredSpaceOptions('');
        resetDataAndFetchResults();
    }

    function clearContributorFilter(evt) {
        evt.stopPropagation();
        const contributorFilter = document.getElementById('contributor-filter');
        contributorFilter.value = '';
        contributorFilter.dataset.key = '';
        displayFilteredContributorOptions('');
        resetDataAndFetchResults();
    }

    /**
     * ========== INFINITE SCROLL & SCROLL-TO-TOP ==========
     */

    function infiniteScrollHandler() {
        if ((window.innerHeight + window.scrollY) >= (document.body.offsetHeight - SCROLL_OFFSET)) {
            loadMoreResults();
        }
    }
    window.addEventListener('scroll', infiniteScrollHandler);

    const scrollToTopButton = document.getElementById('scroll-to-top');
    scrollToTopButton.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    // Show or hide Scroll to Top button
    window.addEventListener('scroll', () => {
        scrollToTopButton.style.display = (window.scrollY > 200) ? 'block' : 'none';
    });

    /**
     * ========== THEME TOGGLE ==========
     */

    function toggleTheme(isChecked) {
        const body = document.body;
        isDarkMode = isChecked;
        if (isDarkMode) {
            body.classList.add('dark-mode');
        } else {
            body.classList.remove('dark-mode');
        }
        // Save preference
        localStorage.setItem('isDarkMode', isDarkMode);
    }

    /**
     * ========== INITIALIZATION (RUN ON DOM READY) ==========
     */
    // Parse query params
    const params = getQueryParams();
    searchText = params.searchText || '';
    baseUrl    = sanitiseBaseUrl(params.baseUrl || '');

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
        pageTitleElem.textContent = `Enhanced Confluence Search Results (${domainName})`;
    }

    // Theme toggle checkbox
    const themeToggleCheckbox = document.getElementById('theme-toggle-checkbox');
    if (themeToggleCheckbox) {
        themeToggleCheckbox.addEventListener('change', () => toggleTheme(themeToggleCheckbox.checked));
        // Load saved theme
        const savedTheme = localStorage.getItem('isDarkMode');
        if (savedTheme === 'true') {
            isDarkMode = true;
            document.body.classList.add('dark-mode');
            themeToggleCheckbox.checked = true;
        }
    }

    // New search elements
    const newSearchInput = document.getElementById('new-search-input');
    const newSearchButton = document.getElementById('new-search-button');
    if (newSearchInput && newSearchButton) {
        newSearchInput.value = searchText;
        newSearchInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                performNewSearch(newSearchInput.value.trim());
            }
        });
        newSearchButton.addEventListener('click', () => {
            performNewSearch(newSearchInput.value.trim());
        });
    }

    // By default, show tree container
    document.getElementById('tree-container').style.display = 'block';

    // Perform initial search if we have searchText
    if (searchText) {
        performNewSearch(searchText);
    }

    // Attach global event listeners
    addEventListeners();
});