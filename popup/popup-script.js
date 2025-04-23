(function() {
    // Function to get URL parameters
    function getQueryParams() {
        let params = {};
        let queryString = window.location.search.substring(1);
        let regex = /([^&=]+)=([^&]*)/g;
        let m;
        while ((m = regex.exec(queryString))) {
            params[decodeURIComponent(m[1])] = decodeURIComponent(m[2]);
        }
        return params;
    }

    function escapeHtml(text) {
        var map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, function(m) { return map[m]; });
    }

    function isValidInput(input) {
        // Allow only alphanumeric characters, spaces, and some special characters
        const regex = /^[a-zA-Z0-9\s\-_.@]*$/;
        return regex.test(input);
    }

    function sanitizeInput(input) {
        // Remove any potentially harmful characters
        return input.replace(/[^a-zA-Z0-9\s\-_.@]/g, '');
    }

    let params = getQueryParams();
    let searchText = params.searchText || '';
    let baseUrl = params.baseUrl || '';

    // Get the domain name from the baseUrl
    var domainName = '';
    try {
        domainName = (new URL(baseUrl)).hostname;
    } catch (e) {
        console.error('Invalid baseUrl:', baseUrl);
    }

    // Update document title
    document.title = `Search results for '${escapeHtml(searchText)}' on ${domainName}`;

    // Update the page header title
    document.getElementById('page-title').textContent = `Enhanced Confluence Search Results (${domainName})`;

    var nodeIdCounter = 0;
    var nodeMap = {};
    var roots = [];
    var searchResultIds = new Set();
    var allExpanded = true;
    var loading = false;
    var allResultsLoaded = false;
    var start = 0;
    var limit = 50; // Number of results per request
    var totalSize = null;
    var allResults = []; // Store all results for table view
    var filteredResults = []; // Results after filtering
    var spaceList = []; // List of spaces for filtering
    var contributorList = []; // List of contributors for filtering
    var fullSpaceList = []; // Full list of spaces
    var fullContributorList = []; // Full list of contributors

    // Variables for sorting
    var currentSortColumn = '';
    var currentSortOrder = 'asc'; // 'asc' or 'desc'

    // Theme toggle
    var isDarkMode = false;

    document.addEventListener('DOMContentLoaded', function() {

        // Add event listener to the new search input and button
        var newSearchInput = document.getElementById('new-search-input');
        var newSearchButton = document.getElementById('new-search-button');
        newSearchInput.value = searchText;

        newSearchInput.addEventListener('keydown', function(event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                performNewSearch(newSearchInput.value.trim());
            }
        });
        newSearchButton.addEventListener('click', function() {
            performNewSearch(newSearchInput.value.trim());
        });

        // Theme toggle checkbox
        var themeToggleCheckbox = document.getElementById('theme-toggle-checkbox');
        themeToggleCheckbox.addEventListener('change', function() {
            toggleTheme(themeToggleCheckbox.checked);
        });

        function toggleTheme(isChecked) {
            var body = document.body;
            isDarkMode = isChecked;
            if (isDarkMode) {
                body.classList.add('dark-mode');
            } else {
                body.classList.remove('dark-mode');
            }
            // Save preference to localStorage
            localStorage.setItem('isDarkMode', isDarkMode);
        }

        // Load theme preference on page load
        (function loadThemePreference() {
            var savedTheme = localStorage.getItem('isDarkMode');
            if (savedTheme === 'true') {
                isDarkMode = true;
                document.body.classList.add('dark-mode');
                themeToggleCheckbox.checked = true;
            }
        })();

        // Initialize the page
        document.getElementById('tree-container').style.display = 'block'; // Show the tree view by default

        // Perform initial search if searchText is provided
        if (searchText) {
            performNewSearch(searchText);
        }

        // Add initial event listeners
        addEventListeners();
    });

    function buildCQL() {
        let cqlParts = [`type=page`];

        // Escape double quotes in searchText
        let escapedSearchText = searchText.replace(/"/g, '\\"');

        // Construct text query
        let textQuery = `(text ~ "${escapedSearchText}" OR title ~ "${escapedSearchText}")`;
        cqlParts.push(textQuery);

        let spaceFilterValue = document.getElementById('space-filter').dataset.key || '';
        let contributorFilterValue = document.getElementById('contributor-filter').dataset.key || '';

        if (spaceFilterValue) {
            cqlParts.push(`space="${spaceFilterValue}"`);
        }

        if (contributorFilterValue) {
            // Use appropriate creator field based on available data
            cqlParts.push(`creator="${contributorFilterValue}"`);
        }

        let cql = cqlParts.join(' AND ');
        return encodeURIComponent(cql);
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
        // Also clear the filter options
        document.getElementById('space-options').innerHTML = '';
        document.getElementById('contributor-options').innerHTML = '';

        // Start loading new results
        loadMoreResults();
    }

    async function loadMoreResults() {
        if (loading || allResultsLoaded) return;
        loading = true;
        showLoadingIndicator(true);

        var cql = buildCQL();

        // Updated search URL to include expand parameter
        var searchUrl = `${baseUrl}/rest/api/content/search?cql=${cql}&limit=${limit}&start=${start}&expand=ancestors,space,history,version`;

        try {
            var searchResponse = await fetch(searchUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                },
                credentials: 'include' // Include cookies for authentication
            });

            if (!searchResponse.ok) {
                throw new Error('Error fetching search results: ' + searchResponse.statusText);
            }

            var searchData = await searchResponse.json();

            if (totalSize === null) {
                totalSize = searchData.totalSize;
            }

            var results = searchData.results;

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

            // Process each result directly
            for (var pageData of results) {
                var pageId = pageData.id;
                if (searchResultIds.has(pageId)) {
                    continue; // Skip duplicates
                }
                searchResultIds.add(pageId);

                allResults.push(pageData); // Add to all results
            }

            // Update the space and contributor filter options based on the new results
            updateFilterOptions();

            // Update the views
            filteredResults = allResults.slice(); // Copy all results
            filterResults();

            if (start >= totalSize) {
                allResultsLoaded = true;
            }
        } catch (error) {
            console.error(error);
            alert('An error occurred: ' + error.message);
        }
        showLoadingIndicator(false);
        loading = false;
    }

    // Function to update space and contributor filter options
    function updateFilterOptions() {
        // Collect space and contributor information from allResults
        spaceList = [];
        contributorList = [];

        allResults.forEach(function(pageData) {
            // Collect space information
            if (pageData.space && pageData.space.key && pageData.space.name) {
                let spaceKey = pageData.space.key;
                if (!spaceList.some(s => s.key === spaceKey)) {
                    spaceList.push({
                        key: spaceKey,
                        name: pageData.space.name,
                        url: baseUrl + pageData.space._links.webui
                    });
                }
            }

            // Collect contributor information (creator)
            if (pageData.history && pageData.history.createdBy) {
                let contributor = pageData.history.createdBy;
                let contributorKey = contributor.username || contributor.userKey || contributor.accountId;
                if (contributorKey && !contributorList.some(c => c.key === contributorKey)) {
                    contributorList.push({
                        key: contributorKey,
                        name: contributor.displayName
                    });
                }
            }
        });

        // Store the full lists
        fullSpaceList = spaceList.slice(); // Make a copy
        fullContributorList = contributorList.slice(); // Make a copy

        // Sort the lists
        fullSpaceList.sort((a, b) => a.name.localeCompare(b.name));
        fullContributorList.sort((a, b) => a.name.localeCompare(b.name));

        // Display the options
        displayFilteredSpaceOptions('');
        displayFilteredContributorOptions('');
    }

    function displayFilteredSpaceOptions(filterValue) {
        var spaceOptionsContainer = document.getElementById('space-options');
        spaceOptionsContainer.innerHTML = '';

        var filteredSpaces = fullSpaceList.filter(space =>
            space.name.toLowerCase().includes(filterValue.toLowerCase())
        );

        filteredSpaces.forEach(space => {
            var option = document.createElement('div');
            option.classList.add('option');
            option.textContent = space.name;
            option.dataset.key = space.key;
            spaceOptionsContainer.appendChild(option);
        });

        // Add event listeners for options
        addOptionListeners(spaceOptionsContainer, 'space-filter', 'space-options');
    }

    function displayFilteredContributorOptions(filterValue) {
        var contributorOptionsContainer = document.getElementById('contributor-options');
        contributorOptionsContainer.innerHTML = '';

        var filteredContributors = fullContributorList.filter(contributor =>
            contributor.name.toLowerCase().includes(filterValue.toLowerCase())
        );

        filteredContributors.forEach(contributor => {
            var option = document.createElement('div');
            option.classList.add('option');
            option.textContent = contributor.name;
            option.dataset.key = contributor.key;
            contributorOptionsContainer.appendChild(option);
        });

        // Add event listeners for options
        addOptionListeners(contributorOptionsContainer, 'contributor-filter', 'contributor-options');
    }

    function addOptionListeners(container, inputId, optionsId) {
        container.querySelectorAll('.option').forEach(function(option) {
            option.addEventListener('click', function() {
                var input = document.getElementById(inputId);
                input.value = option.textContent;
                input.dataset.key = option.dataset.key;
                container.style.display = 'none';

                resetDataAndFetchResults();
            });
        });
    }

    function formatDate(dateString) {
        let date = new Date(dateString);
        let day = String(date.getDate()).padStart(2, '0');
        let month = String(date.getMonth() + 1).padStart(2, '0'); // Months are zero-based
        let year = date.getFullYear();
        let hours = String(date.getHours()).padStart(2, '0');
        let minutes = String(date.getMinutes()).padStart(2, '0');

        return day + '/' + month + '/' + year + ' at ' + hours + ':' + minutes;
    }

    function filterResults() {
        var textFilterValue = document.getElementById('text-filter').value.toLowerCase();

        filteredResults = allResults.filter(function(pageData) {
            var matchesText = true;

            if (textFilterValue) {
                var title = pageData.title.toLowerCase();
                matchesText = title.includes(textFilterValue);
            }

            return matchesText;
        });

        // Apply sorting
        if (currentSortColumn) {
            sortResults(currentSortColumn, currentSortOrder);
        }

        // Update the views with filtered results
        if (filteredResults.length === 0) {
            showNoResultsMessage();
        } else {
            updateTableHtml(filteredResults);
            updateTreeHtml(filteredResults);
            addEventListeners();
        }
    }

    function sortResults(column, order) {
        filteredResults.sort(function(a, b) {
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
                    valA = a.history && a.history.createdBy ? a.history.createdBy.displayName.toLowerCase() : '';
                    valB = b.history && b.history.createdBy ? b.history.createdBy.displayName.toLowerCase() : '';
                    break;
                case 'Date Created':
                    valA = a.history && a.history.createdDate ? new Date(a.history.createdDate) : new Date(0);
                    valB = b.history && b.history.createdDate ? new Date(b.history.createdDate) : new Date(0);
                    break;
                case 'Last Modified':
                    valA = a.version && a.version.when ? new Date(a.version.when) : new Date(0);
                    valB = b.version && b.version.when ? new Date(b.version.when) : new Date(0);
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
        // Clear existing nodeMap and roots
        nodeMap = {};
        roots = [];
        // Build the tree structure
        for (var pageData of results) {
            // Create nodes for ancestors
            if (pageData.ancestors) {
                for (var ancestor of pageData.ancestors) {
                    var id = ancestor.id;
                    if (!nodeMap[id]) {
                        nodeMap[id] = {
                            id: id,
                            title: ancestor.title,
                            url: baseUrl + ancestor._links.webui,
                            children: [],
                            isSearchResult: false,
                            expanded: true
                        };
                    }
                }
            }
            // Create node for the page itself
            var id = pageData.id;
            if (!nodeMap[id]) {
                nodeMap[id] = {
                    id: id,
                    title: pageData.title,
                    url: baseUrl + pageData._links.webui,
                    children: [],
                    isSearchResult: true,
                    expanded: true
                };
            }
        }

        // Now, build the tree by linking nodes
        for (var pageData of results) {
            var ancestors = pageData.ancestors || [];
            var pageNode = nodeMap[pageData.id];

            // Start from the root ancestor
            if (ancestors.length > 0) {
                var rootAncestorId = ancestors[0].id;
                var rootAncestorNode = nodeMap[rootAncestorId];

                // Build the hierarchy
                var parentNode = null;
                for (var ancestor of ancestors) {
                    var ancestorNode = nodeMap[ancestor.id];
                    if (parentNode && !parentNode.children.includes(ancestorNode)) {
                        parentNode.children.push(ancestorNode);
                    }
                    parentNode = ancestorNode;
                }

                // Add the page as a child of its parent
                if (parentNode && !parentNode.children.includes(pageNode)) {
                    parentNode.children.push(pageNode);
                }

                // Ensure the root ancestor is added to roots if not already present
                if (!roots.includes(rootAncestorNode)) {
                    roots.push(rootAncestorNode);
                }
            } else {
                // Page has no ancestors, it's a root page
                if (!roots.includes(pageNode)) {
                    roots.push(pageNode);
                }
            }
        }

        // Generate the tree HTML
        var treeContainer = document.getElementById('tree-container');
        var treeHtml = generateTreeHtml(roots);
        treeContainer.innerHTML = treeHtml;
    }

    function generateTreeHtml(nodes) {
        let html = '<ul>';
        for (let node of nodes) {
            let nodeClass = node.isSearchResult ? 'search-result' : 'ancestor';
            let hasChildren = node.children.length > 0;
            let nodeId = 'node-' + (nodeIdCounter++);
            let arrow = hasChildren ? '<span class="arrow expanded"></span>' : '<span class="arrow empty"></span>';

            html += '<li id="' + nodeId + '" class="' + nodeClass + '">';
            html += arrow + ' <a href="' + node.url + '" target="_blank">' + node.title + '</a>';

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
        let html = generateTableHtml(results);
        var tableContainer = document.getElementById('table-container');
        tableContainer.innerHTML = html;
    }

    function generateTableHtml(results) {
        let html = '<table>';
        html += '<thead><tr>';
        html += '<th data-column="Page Name">Page Name</th>';
        html += '<th data-column="Page Space">Page Space</th>';
        html += '<th data-column="Contributor">Contributor</th>';
        html += '<th data-column="Date Created">Date Created</th>';
        html += '<th data-column="Last Modified">Last Modified</th>';
        html += '</tr></thead>';
        html += '<tbody>';

        for (let pageData of results) {
            let title = pageData.title;
            let url = baseUrl + pageData._links.webui;
            let spaceName = pageData.space ? pageData.space.name : '';
            let spaceUrl = pageData.space && pageData.space._links && pageData.space._links.webui ? baseUrl + pageData.space._links.webui : '';
            let createdDate = pageData.history && pageData.history.createdDate ? formatDate(pageData.history.createdDate) : 'N/A';
            let modifiedDate = pageData.version && pageData.version.when ? formatDate(pageData.version.when) : 'N/A';
            let contributorName = pageData.history && pageData.history.createdBy ? pageData.history.createdBy.displayName : 'Unknown';

            html += '<tr>';
            html += '<td><a href="' + url + '" target="_blank">' + title + '</a></td>';
            if (spaceName && spaceUrl) {
                html += '<td><a href="' + spaceUrl + '" target="_blank">' + spaceName + '</a></td>';
            } else {
                html += '<td>' + spaceName + '</td>';
            }
            html += '<td>' + contributorName + '</td>';
            html += '<td>' + createdDate + '</td>';
            html += '<td>' + modifiedDate + '</td>';
            html += '</tr>';
        }

        html += '</tbody></table>';
        return html;
    }

    function showNoResultsMessage() {
        var treeContainer = document.getElementById('tree-container');
        var tableContainer = document.getElementById('table-container');
        var message = '<p>No results found.</p>';

        treeContainer.innerHTML = message;
        tableContainer.innerHTML = message;
    }

    function addEventListeners() {
        // Tree View Events
        var arrows = document.querySelectorAll('.arrow');

        arrows.forEach(function(arrow) {
            if (!arrow.dataset.listenerAdded) {
                arrow.addEventListener('click', function(event) {
                    var li = event.target.parentElement;
                    var childrenDiv = li.querySelector('.children');

                    if (childrenDiv) {
                        if (childrenDiv.style.display === 'none') {
                            childrenDiv.style.display = 'block';
                            arrow.classList.remove('collapsed');
                            arrow.classList.add('expanded');
                        } else {
                            childrenDiv.style.display = 'none';
                            arrow.classList.remove('expanded');
                            arrow.classList.add('collapsed');
                        }
                    }
                });
                arrow.dataset.listenerAdded = true;
            }
        });

        // Toggle All Button
        var toggleButton = document.getElementById('toggle-all');
        toggleButton.removeEventListener('click', toggleAllHandler);
        toggleButton.addEventListener('click', toggleAllHandler);

        // View Switcher Buttons
        var treeViewBtn = document.getElementById('tree-view-btn');
        var tableViewBtn = document.getElementById('table-view-btn');

        treeViewBtn.removeEventListener('click', switchToTreeView);
        treeViewBtn.addEventListener('click', switchToTreeView);

        tableViewBtn.removeEventListener('click', switchToTableView);
        tableViewBtn.addEventListener('click', switchToTableView);

        // Initialize view to Tree View
        if (!document.getElementById('table-view-btn').classList.contains('active')) {
            switchToTreeView();
        } else {
            switchToTableView();
        }

        // Filter Controls
        var textFilter = document.getElementById('text-filter');
        var spaceFilter = document.getElementById('space-filter');
        var contributorFilter = document.getElementById('contributor-filter');

        textFilter.removeEventListener('input', filterResults);
        textFilter.addEventListener('input', filterResults);

        // Add input event listeners for typing
        spaceFilter.addEventListener('input', function(event) {
            if (!isValidInput(event.target.value)) {
                alert('Invalid input. Please use only alphanumeric characters, spaces, and -_.@');
                event.target.value = '';
            } else {
                event.target.value = sanitizeInput(event.target.value);
            }
            displayFilteredSpaceOptions(event.target.value);
            document.getElementById('space-options').style.display = 'block';
        });

        contributorFilter.addEventListener('input', function(event) {
            if (!isValidInput(event.target.value)) {
                alert('Invalid input. Please use only alphanumeric characters, spaces, and -_.@');
                event.target.value = '';
            } else {
                event.target.value = sanitizeInput(event.target.value);
            }
            displayFilteredContributorOptions(event.target.value);
            document.getElementById('contributor-options').style.display = 'block';
        });

        // Show options on focus
        spaceFilter.addEventListener('focus', function(event) {
            displayFilteredSpaceOptions(event.target.value);
            document.getElementById('space-options').style.display = 'block';
        });

        contributorFilter.addEventListener('focus', function(event) {
            displayFilteredContributorOptions(event.target.value);
            document.getElementById('contributor-options').style.display = 'block';
        });

        // Clear icons for filters
        var spaceClear = document.getElementById('space-clear');
        var contributorClear = document.getElementById('contributor-clear');

        spaceClear.removeEventListener('click', clearSpaceFilter);
        spaceClear.addEventListener('click', clearSpaceFilter);

        contributorClear.removeEventListener('click', clearContributorFilter);
        contributorClear.addEventListener('click', clearContributorFilter);

        // Close options when clicking outside
        document.addEventListener('click', function(event) {
            if (!event.target.closest('#space-filter-container')) {
                document.getElementById('space-options').style.display = 'none';
            }
            if (!event.target.closest('#contributor-filter-container')) {
                document.getElementById('contributor-options').style.display = 'none';
            }
        });

        // Table Header Sorting
        var tableHeaders = document.querySelectorAll('#table-container th');

        tableHeaders.forEach(function(header) {
            header.style.cursor = 'pointer';
            header.addEventListener('click', function() {
                var column = header.getAttribute('data-column');
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

    function clearSpaceFilter(event) {
        event.stopPropagation();
        var spaceFilter = document.getElementById('space-filter');
        spaceFilter.value = '';
        spaceFilter.dataset.key = '';
        displayFilteredSpaceOptions('');
        resetDataAndFetchResults();
    }

    function clearContributorFilter(event) {
        event.stopPropagation();
        var contributorFilter = document.getElementById('contributor-filter');
        contributorFilter.value = '';
        contributorFilter.dataset.key = '';
        displayFilteredContributorOptions('');
        resetDataAndFetchResults();
    }

    function toggleAllHandler() {
        var childrenDivs = document.querySelectorAll('.children');
        var arrows = document.querySelectorAll('.arrow');
        var toggleButton = document.getElementById('toggle-all');

        if (allExpanded) {
            // Collapse all
            childrenDivs.forEach(function(div) {
                div.style.display = 'none';
            });
            arrows.forEach(function(arrow) {
                arrow.classList.remove('expanded');
                arrow.classList.add('collapsed');
            });
            toggleButton.textContent = 'Expand All';
            allExpanded = false;
        } else {
            // Expand all
            childrenDivs.forEach(function(div) {
                div.style.display = 'block';
            });
            arrows.forEach(function(arrow) {
                arrow.classList.remove('collapsed');
                arrow.classList.add('expanded');
            });
            toggleButton.textContent = 'Collapse All';
            allExpanded = true;
        }
    }

    function showLoadingIndicator(show) {
        var indicator = document.getElementById('loading-indicator');
        if (show) {
            indicator.style.display = 'block';
        } else {
            indicator.style.display = 'none';
        }
    }

    // Infinite Scrolling
    function infiniteScrollHandler() {
        if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 500) {
            loadMoreResults();
        }
    }

    window.addEventListener('scroll', infiniteScrollHandler);

    // Scroll to Top Button
    var scrollToTopButton = document.getElementById('scroll-to-top');
    scrollToTopButton.addEventListener('click', function() {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Show or hide Scroll to Top button
    window.addEventListener('scroll', function() {
        if (window.scrollY > 200) {
            scrollToTopButton.style.display = 'block';
        } else {
            scrollToTopButton.style.display = 'none';
        }
    });

    // Initialize the page
    document.getElementById('tree-container').style.display = 'block'; // Show the tree view by default

    // Perform initial search if searchText is provided
    if (searchText) {
        performNewSearch(searchText);
    }

    // Add initial event listeners
    addEventListeners();
})();
