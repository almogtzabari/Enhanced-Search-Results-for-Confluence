/**
 * options.js
 * Handles the options/settings page for the Enhanced Search Results for Confluence extension.
 * Users can configure domain-specific search input IDs and toggle dark mode.
 */

const DEBUG = false;
const log = {
    debug: (...args) => DEBUG && console.debug('[DEBUG]', ...args),
    info: (...args) => console.info('[INFO]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    error: (...args) => console.error('[ERROR]', ...args)
};

document.addEventListener('DOMContentLoaded', () => {
    const domainSettingsContainer = document.getElementById('domainSettings');
    const addDomainButton = document.getElementById('addDomain');
    const saveButton = document.getElementById('save');
    const statusDiv = document.getElementById('status');
    const darkModeToggle = document.getElementById('darkModeToggle');
    const tooltipToggle = document.getElementById('tooltipToggle');

    // === Load and Apply Saved Settings ===
    const resultsPerRequestSelect = document.getElementById('resultsPerRequest');
    chrome.storage.sync.get(['domainSettings', 'darkMode', 'showTooltips', 'enableSummaries', 'resultsPerRequest', 'openaiApiKey', 'customApiEndpoint'], (data) => {
        const domainSettings = data.domainSettings || [];

        if (data.resultsPerRequest && ['50', '75', '100', '125', '150', '200'].includes(String(data.resultsPerRequest))) {
            resultsPerRequestSelect.value = String(data.resultsPerRequest);
        }

        if (domainSettings.length > 0) {
            domainSettings.forEach(entry => addDomainEntry(entry.domain, entry.searchInputId));
        } else {
            // Show at least one blank entry if no settings saved
            addDomainEntry('', '');
        }

        darkModeToggle.checked = Boolean(data.darkMode);
        const tooltipEnabled = data.showTooltips !== false;
        tooltipToggle.checked = tooltipEnabled;

        const enableSummariesToggle = document.getElementById('enableSummariesToggle');
        enableSummariesToggle.checked = data.enableSummaries === true;
        enableSummariesToggle.addEventListener('change', () => {
            const enabled = enableSummariesToggle.checked;
            chrome.storage.sync.set({ enableSummaries: enabled }, () => {
                log.debug('Enable summaries setting saved:', enabled);
            });
        });
        if (!('showTooltips' in data)) {
            chrome.storage.sync.set({ showTooltips: true });
        }

        const customApiEndpointInput = document.getElementById('customApiEndpoint');
        if (customApiEndpointInput) {
            customApiEndpointInput.value = data.customApiEndpoint || '';
            customApiEndpointInput.addEventListener('input', () => {
                chrome.storage.sync.set({ customApiEndpoint: customApiEndpointInput.value.trim() }, () => {
                    log.debug('Saved custom API endpoint');
                });
            });
        }

        if (darkModeToggle.checked) {
            document.body.classList.add('dark-mode');
        }

        const openaiApiKeyInput = document.getElementById('openaiApiKey');
        if (openaiApiKeyInput) {
            openaiApiKeyInput.value = data.openaiApiKey || '';
            const customUserPromptInput = document.getElementById('customUserPrompt');
            if (customUserPromptInput) {
                customUserPromptInput.value = data.customUserPrompt || '';
                customUserPromptInput.addEventListener('input', () => {
                    chrome.storage.sync.set({ customUserPrompt: customUserPromptInput.value.trim() }, () => {
                        log.debug('Saved custom user prompt');
                    });
                });
            }
            openaiApiKeyInput.addEventListener('input', () => {
                chrome.storage.sync.set({ openaiApiKey: openaiApiKeyInput.value.trim() }, () => {
                    log.debug('Saved OpenAI API key');
                });
            });
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
            log.debug('Dark mode setting saved:', isDark);
        });
    });

    tooltipToggle.addEventListener('change', () => {
        const show = tooltipToggle.checked;
        chrome.storage.sync.set({ showTooltips: show }, () => {
            log.debug('Tooltip setting saved:', show);
        });
    });

    // === Event: Save Settings ===
    resultsPerRequestSelect.addEventListener('change', () => {
        const value = parseInt(resultsPerRequestSelect.value, 10);
        chrome.storage.sync.set({ resultsPerRequest: value }, () => {
            log.debug('Saved resultsPerRequest:', value);
        });
    });
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
                log.warn('Invalid domain or input ID detected. Ignoring entry.');
                showStatus('Invalid input. Please check your domain and search input ID.', 'error');
                return;
            }
        }

        if (domainSettings.length === 0) {
            chrome.storage.sync.set({ domainSettings: [] }, () => {
                showStatus('No domains configured. Extension will not auto-inject.', 'success');
                saveButton.disabled = true;
            });
            return;
        }

        const isFirefox = typeof InstallTrigger !== 'undefined';

        if (isFirefox) {
            // Firefox: assume permission declared in manifest
            chrome.storage.sync.set({ domainSettings }, () => {
                log.info('Saved domain settings:', domainSettings);
                showStatus('Settings saved (permissions assumed granted in Firefox).', 'success');
                saveButton.disabled = true;
            });
        } else if (chrome.permissions && typeof chrome.permissions.request === 'function') {
            const origins = domains.map(domain => `*://${domain}/*`);
            chrome.permissions.request({ origins }, (granted) => {
                if (granted) {
                    chrome.storage.sync.set({ domainSettings }, () => {
                        log.info('Saved domain settings:', domainSettings);
                        showStatus('Settings saved and permissions granted!', 'success');
                        saveButton.disabled = true;
                    });
                } else {
                    if (chrome.runtime.lastError) {
                        console.error(chrome.runtime.lastError);
                        showStatus(`Permissions denied: ${chrome.runtime.lastError.message}`, 'error');
                    } else {
                        log.warn('User denied permissions for domains:', origins);
                        showStatus('Permissions denied.', 'error');
                    }
                }
            });
        } else {
            // Fallback (shouldn't happen in Chrome or Firefox)
            chrome.storage.sync.set({ domainSettings }, () => {
                showStatus('Settings saved (no permission API).', 'success');
                saveButton.disabled = true;
            });
        }
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

    // === Toggle Advanced Settings Section ===
    const advToggle = document.getElementById('advancedSettingsToggle');
    const advContent = document.getElementById('advancedSettingsContent');
    advToggle.addEventListener('click', () => {
        const isVisible = advContent.style.display === 'block';
        advContent.style.display = isVisible ? 'none' : 'block';
        advToggle.textContent = `Advanced Settings ${isVisible ? '▸' : '▾'}`;
    });

    // === Helper: Input ID Validation ===
    function isValidInputId(inputId) {
        const regex = /^[a-zA-Z0-9-_]+$/;
        return regex.test(inputId);
    }
});
