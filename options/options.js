document.addEventListener('DOMContentLoaded', () => {
    const domainSettingsContainer = document.getElementById('domainSettings');
    const addDomainButton = document.getElementById('addDomain');
    const saveButton = document.getElementById('save');
    const statusDiv = document.getElementById('status');
    const darkModeToggle = document.getElementById('darkModeToggle');

    // Load existing settings
    chrome.storage.sync.get(['domainSettings', 'darkMode'], (data) => {
        if (data.domainSettings && data.domainSettings.length > 0) {
            data.domainSettings.forEach(entry => {
                addDomainEntry(entry.domain, entry.searchInputId);
            });
        } else {
            addDomainEntry('', '');
        }
        if (data.darkMode) {
            darkModeToggle.checked = true;
            document.body.classList.add('dark-mode');
        }
        // Enable save button if there is any data loaded
        if (data.domainSettings && data.domainSettings.length > 0) {
            saveButton.disabled = false;
        }
    });

    // Add Domain Entry
    addDomainButton.addEventListener('click', () => {
        addDomainEntry('', '');
        saveButton.disabled = false;
    });

    // Toggle Dark Mode
    darkModeToggle.addEventListener('change', () => {
        if (darkModeToggle.checked) {
            document.body.classList.add('dark-mode');
            chrome.storage.sync.set({ darkMode: true });
        } else {
            document.body.classList.remove('dark-mode');
            chrome.storage.sync.set({ darkMode: false });
        }
    });

    // Save settings and request permissions
    saveButton.addEventListener('click', () => {
        const domainEntries = domainSettingsContainer.querySelectorAll('.domain-entry');
        const domainSettings = [];
        const domains = [];

        domainEntries.forEach(entry => {
            const domainInput = entry.querySelector('.domain-input');
            const searchInputIdInput = entry.querySelector('.search-input-id-input');

            const domain = domainInput.value.trim();
            const searchInputId = searchInputIdInput.value.trim() || 'search-filter-input';

            if (isValidDomain(domain) && isValidInputId(searchInputId)) {
                domainSettings.push({ domain, searchInputId });
                domains.push(domain);
            } else {
                showStatus('Invalid input. Please check your domain and search input ID.', 'error');
                return;
            }
        });

        if (domainSettings.length === 0) {
            showStatus('Please enter at least one valid domain.', 'error');
            return;
        }

        // Save settings
        chrome.storage.sync.set({ domainSettings }, () => {
            // Request permissions for the domains
            const origins = domains.map(domain => `*://${domain}/*`);

            chrome.permissions.request({
                origins: origins
            }, (granted) => {
                if (granted) {
                    showStatus('Settings saved and permissions granted!', 'success');
                    saveButton.disabled = true;
                } else {
                    // Check for runtime errors
                    if (chrome.runtime.lastError) {
                        console.error(chrome.runtime.lastError);
                        showStatus(`Permissions denied: ${chrome.runtime.lastError.message}`, 'error');
                    } else {
                        showStatus('Permissions denied.', 'error');
                    }
                }
            });
        });
    });

    function addDomainEntry(domainValue, searchInputIdValue) {
        const entryDiv = document.createElement('div');
        entryDiv.className = 'domain-entry';

        const domainInput = document.createElement('input');
        domainInput.type = 'text';
        domainInput.placeholder = 'Domain (e.g., example.com)';
        domainInput.className = 'domain-input';
        domainInput.value = domainValue;
        domainInput.addEventListener('input', () => {
            saveButton.disabled = false;
        });

        const searchInputIdInput = document.createElement('input');
        searchInputIdInput.type = 'text';
        searchInputIdInput.placeholder = 'Search input ID (e.g., search-filter-input)';
        searchInputIdInput.className = 'search-input-id-input';
        searchInputIdInput.value = searchInputIdValue;
        searchInputIdInput.addEventListener('input', () => {
            saveButton.disabled = false;
        });

        const removeButton = document.createElement('button');
        removeButton.className = 'remove-domain';
        removeButton.textContent = 'Remove';
        removeButton.addEventListener('click', () => {
            domainSettingsContainer.removeChild(entryDiv);
            saveButton.disabled = false;
        });

        entryDiv.appendChild(domainInput);
        entryDiv.appendChild(searchInputIdInput);
        entryDiv.appendChild(removeButton);

        domainSettingsContainer.appendChild(entryDiv);
    }

    function showStatus(message, type) {
        statusDiv.textContent = message;
        statusDiv.className = `status ${type}`;
        // Do not clear the status message automatically
        // It will remain until the user makes another change or navigates away
    }

    function isValidDomain(domain) {
        // Simple regex to validate domain format
        const regex = /^(?!:\/\/)([a-zA-Z0-9-_]+\.)*[a-zA-Z0-9][a-zA-Z0-9-_]+\.[a-zA-Z]{2,11}?$/;
        return regex.test(domain);
    }

    function isValidInputId(inputId) {
        // Allow only alphanumeric characters, hyphens, and underscores
        const regex = /^[a-zA-Z0-9-_]+$/;
        return regex.test(inputId);
    }
});
