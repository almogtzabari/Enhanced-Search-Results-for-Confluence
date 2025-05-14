/**
 * options.js
 * Handles the options/settings page for the Enhanced Confluence Search Results extension.
 * Users can configure domain-specific search input IDs and toggle dark mode.
 */

document.addEventListener('DOMContentLoaded', () => {
    const domainSettingsContainer = document.getElementById('domainSettings');
    const addDomainButton = document.getElementById('addDomain');
    const saveButton = document.getElementById('save');
    const statusDiv = document.getElementById('status');
    const darkModeToggle = document.getElementById('darkModeToggle');
    const tooltipToggle = document.getElementById('tooltipToggle');

    // === Load and Apply Saved Settings ===
    chrome.storage.sync.get(['domainSettings', 'darkMode', 'showTooltips'], (data) => {
        const domainSettings = data.domainSettings || [];

        if (domainSettings.length > 0) {
            domainSettings.forEach(entry => addDomainEntry(entry.domain, entry.searchInputId));
        } else {
            // Show at least one blank entry if no settings saved
            addDomainEntry('', '');
        }

        darkModeToggle.checked = Boolean(data.darkMode);
        tooltipToggle.checked = Boolean(data.showTooltips);

        if (darkModeToggle.checked) {
            document.body.classList.add('dark-mode');
        }

        if (domainSettings.length > 0) {
            saveButton.disabled = false;
        }
    });

    // === Event: Add Domain Entry ===
    addDomainButton.addEventListener('click', () => {
        addDomainEntry('', '');
        saveButton.disabled = false;
    });

    // === Event: Toggle Dark Mode ===
    darkModeToggle.addEventListener('change', () => {
        const isDark = darkModeToggle.checked;
        document.body.classList.toggle('dark-mode', isDark);
        chrome.storage.sync.set({ darkMode: isDark }, () => {
            console.log('Dark mode setting saved:', isDark);
        });
    });

    tooltipToggle.addEventListener('change', () => {
        const show = tooltipToggle.checked;
        chrome.storage.sync.set({ showTooltips: show }, () => {
            console.log('Tooltip setting saved:', show);
        });
    });

    // === Event: Save Settings ===
    saveButton.addEventListener('click', () => {
        const domainEntries = domainSettingsContainer.querySelectorAll('.domain-entry');
        const domainSettings = [];
        const domains = [];

        for (const entry of domainEntries) {
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
        }

        if (domainSettings.length === 0) {
            showStatus('Please enter at least one valid domain.', 'error');
            return;
        }

        chrome.storage.sync.set({ domainSettings }, () => {
            const origins = domains.map(domain => `*://${domain}/*`);

            // Request permissions for all domains
            chrome.permissions.request({ origins }, (granted) => {
                if (granted) {
                    showStatus('Settings saved and permissions granted!', 'success');
                    saveButton.disabled = true;
                } else {
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

    // === Helper: Add Domain Entry to DOM ===
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

    // === Helper: Show Status Message ===
    function showStatus(message, type) {
        statusDiv.textContent = message;
        statusDiv.className = `status ${type}`;
    }

    // === Helper: Domain Format Validation ===
    function isValidDomain(domain) {
        const regex = /^(?!:\/\/)([a-zA-Z0-9-_]+\.)*[a-zA-Z0-9][a-zA-Z0-9-_]+\.[a-zA-Z]{2,11}?$/;
        return regex.test(domain);
    }

    // === Helper: Input ID Validation ===
    function isValidInputId(inputId) {
        const regex = /^[a-zA-Z0-9-_]+$/;
        return regex.test(inputId);
    }
});
