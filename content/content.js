/**
 * content.js
 * Injected into Confluence pages based on user-defined domain settings.
 * Waits for the search input element and binds an Enter key listener.
 * When Enter is pressed, a new tab opens with enhanced search results.
 */

(function() {
    // Ensure the script runs even if the DOM is already loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // === Initialization Entry Point ===
    function initialize() {
        let searchInputId = 'search-filter-input'; // Default ID if not overridden by settings

        // Retrieve domain-specific settings from Chrome storage
        chrome.storage.sync.get(['domainSettings'], (data) => {
            const domainSettings = data.domainSettings || [];
            const currentDomain = window.location.hostname;
            const matchingSetting = domainSettings.find(entry => currentDomain.includes(entry.domain));

            if (matchingSetting) {
                searchInputId = matchingSetting.searchInputId || 'search-filter-input';
                waitForSearchInput();
            }
        });

        // === Trigger the enhanced search popup when Enter is pressed ===
        function executeSearch(initialSearchText) {
            let searchText = initialSearchText || '';

            if (!searchText) {
                const searchInputElement = document.getElementById(searchInputId);
                if (!searchInputElement || !searchInputElement.value.trim()) {
                    alert('No search text entered in the search box.');
                    return;
                }
                searchText = searchInputElement.value.trim();
            }

            const baseUrl = window.location.origin;
            let pageUrl = chrome.runtime.getURL('popup/popup.html');
            pageUrl += `?searchText=${encodeURIComponent(searchText)}&baseUrl=${encodeURIComponent(baseUrl)}`;

            // Ask the background script to open a new tab with the results
            chrome.runtime.sendMessage({ action: 'openTab', url: pageUrl });
        }

        // === Poll until the target search input appears on the page ===
        function waitForSearchInput() {
            const interval = setInterval(() => {
                const searchInputElement = document.getElementById(searchInputId);
                if (searchInputElement) {
                    // Attach Enter key listener to trigger search
                    searchInputElement.addEventListener('keydown', (event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            executeSearch();
                        }
                    });
                    clearInterval(interval);
                }
            }, 500); // Retry every 500ms
        }
    }
})();