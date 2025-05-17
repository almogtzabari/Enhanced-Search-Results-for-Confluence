(function () {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        let searchInputId = 'search-filter-input'; // Default search input ID

        // Retrieve domain-specific settings from Chrome storage
        chrome.storage.sync.get(['domainSettings'], ({ domainSettings = [] }) => {
            const match = domainSettings.find((e) => window.location.hostname.includes(e.domain));
            if (match) {
                searchInputId = match.searchInputId || searchInputId;
                waitForInput();
            }
        });

        // Opens a popup with search results or an empty input for user queries
        function executeSearch(initial = '') {
            let text = initial;
            const input = document.getElementById(searchInputId);
            if (!text && input) text = input.value.trim();

            const baseUrl = window.location.origin;
            const url = `${chrome.runtime.getURL('popup/popup.html')}?searchText=${encodeURIComponent(
                text,
            )}&baseUrl=${encodeURIComponent(baseUrl)}`;
            chrome.runtime.sendMessage({ action: 'openTab', url });
        }

        // Monitors the DOM for the search input and adds the Enhanced Search button
        function waitForInput() {
            const observer = new MutationObserver(() => {
                const input = document.getElementById(searchInputId);
                if (input && !document.getElementById('enhanced-search-button')) {
                    addEnhancedButton(input);
                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            executeSearch();
                        }
                    });
                    observer.disconnect(); // Stop observing once input is initialized
                }
            });

            // Observe changes in the DOM to detect the search input
            observer.observe(document.body, { childList: true, subtree: true });

            // Check if the search input is already present
            const input = document.getElementById(searchInputId);
            if (input && !document.getElementById('enhanced-search-button')) {
                addEnhancedButton(input);
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        executeSearch();
                    }
                });
            }
        }

        // Creates and styles the Enhanced Search button, then appends it next to the search input
        function addEnhancedButton(input) {
            if (document.getElementById('enhanced-search-button')) return;

            const btn = document.createElement('button');
            btn.id = 'enhanced-search-button';
            btn.textContent = '🔍 Enhanced Search';

            const h = input.offsetHeight || 28;
            Object.assign(btn.style, {
                marginLeft: '8px',
                height: `${h}px`,
                padding: '0 12px',
                borderRadius: '3px',
                border: '1px solid #0052CC',
                background: '#0052CC',
                color: '#FFF',
                fontSize: '12px',
                lineHeight: `${h}px`,
                cursor: 'pointer',
            });

            btn.addEventListener('click', () => executeSearch());
            input.insertAdjacentElement('afterend', btn);
        }
    }
})();