(function() {
    // Retrieve the search input ID and domains from storage or use defaults
    let searchInputId = 'search-filter-input'; // Default ID
    let domainSettings = [];

    chrome.storage.sync.get(['domainSettings'], (data) => {
        if (data.domainSettings && data.domainSettings.length > 0) {
            domainSettings = data.domainSettings;
        }

        const currentDomain = window.location.hostname;
        const matchingSetting = domainSettings.find(entry => currentDomain.includes(entry.domain));

        if (matchingSetting) {
            searchInputId = matchingSetting.searchInputId || 'search-filter-input';
            // Call the function to wait for the element
            waitForSearchInput();
        }
    });

    // Function to execute when Enter is pressed
    async function executeSearch(initialSearchText) {
        let searchText = initialSearchText || '';
        if (!searchText) {
            let searchInputElement = document.getElementById(searchInputId);
            if (!searchInputElement || !searchInputElement.value.trim()) {
                alert("No search text entered in the search box.");
                return;
            }
            searchText = searchInputElement.value.trim();
        }

        let baseUrl = window.location.origin;

        // Construct the URL to your HTML page with query parameters
        let pageUrl = chrome.runtime.getURL('popup/popup.html');
        pageUrl += `?searchText=${encodeURIComponent(searchText)}&baseUrl=${encodeURIComponent(baseUrl)}`;

        // Send a message to the background script to open a new tab
        chrome.runtime.sendMessage({ action: 'openTab', url: pageUrl });
    }

    // Function to wait for the search input element to exist
    function waitForSearchInput() {
        // Check every 500ms if the element exists
        var interval = setInterval(function() {
            let searchInputElement = document.getElementById(searchInputId);

            // If the element exists, add the event listener and stop checking
            if (searchInputElement) {
                searchInputElement.addEventListener('keydown', function(event) {
                    if (event.key === 'Enter') {
                        event.preventDefault(); // Prevent the default form submission if necessary
                        executeSearch();
                    }
                });
                clearInterval(interval); // Stop the interval once the element is found
            }
        }, 500); // Check every 500ms
    }
})();
