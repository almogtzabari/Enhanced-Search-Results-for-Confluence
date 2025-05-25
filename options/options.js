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
    const clearSummariesButton = document.getElementById('clearSummaries');
    const clearConversationsButton = document.getElementById('clearConversations');
    clearConversationsButton.addEventListener('click', () => {
        showConfirmationDialog('<h2>Are you sure you want to delete all saved conversation history?</h2>This cannot be undone.', () => {
            triggerPoofEffect();
            const request = indexedDB.open('ConfluenceSummariesDB', 2);

            request.onsuccess = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('conversations')) {
                    return;
                }

                const tx = db.transaction('conversations', 'readwrite');
                const store = tx.objectStore('conversations');
                const clearRequest = store.clear();

                clearRequest.onerror = () => {
                    console.error('[ERROR] Failed to clear conversation history:', clearRequest.error);
                    alert('Failed to clear conversation history.', 'error');
                };
            };

            request.onerror = () => {
                console.error('[ERROR] Failed to open database:', request.error);
                alert('Could not access conversation store.', 'error');
            };
        });
    });

    clearSummariesButton.addEventListener('click', () => {
        showConfirmationDialog('<h2>Are you sure you want to delete all cached AI summaries?</h2>This will remove both <b>summaries</b> and <b>follow-up conversations</b>. This cannot be undone.', () => {
            triggerPoofEffect();
            const request = indexedDB.open('ConfluenceSummariesDB', 2);

            request.onsuccess = () => {
                const db = request.result;
                const tx = db.transaction(['summaries', 'conversations'], 'readwrite');

                const summariesStore = tx.objectStore('summaries');
                const conversationsStore = tx.objectStore('conversations');

                const clearSummaries = summariesStore.clear();
                const clearConversations = conversationsStore.clear();

                let cleared = 0;
                const done = () => {
                    if (++cleared === 2) {
                        chrome.runtime.sendMessage({ action: 'summariesCleared' });
                    }
                };
                const fail = (label, error) => {
                    console.error(`[ERROR] Failed to clear ${label}:`, error);
                    alert(`Failed to clear ${label}.`, 'error');
                };

                clearSummaries.onsuccess = done;
                clearConversations.onsuccess = done;
                clearSummaries.onerror = () => fail('summaries', clearSummaries.error);
                clearConversations.onerror = () => fail('conversations', clearConversations.error);

            };

            request.onerror = () => {
                console.error('[ERROR] Failed to open database:', request.error);
                alert('Could not access summary cache.', 'error');
            };
        });
    });

    const domainSettingsContainer = document.getElementById('domainSettings');
    const addDomainButton = document.getElementById('addDomain');
    const saveButton = document.getElementById('save');
    const statusDiv = document.getElementById('status');
    const darkModeToggle = document.getElementById('darkModeToggle');
    const tooltipToggle = document.getElementById('tooltipToggle');

    // === Load and Apply Saved Settings ===
    const resultsPerRequestSelect = document.getElementById('resultsPerRequest');
    chrome.storage.sync.get(['domainSettings', 'darkMode', 'showTooltips', 'enableSummaries', 'resultsPerRequest', 'openaiApiKey', 'customApiEndpoint'], (syncData) => {
        chrome.storage.local.get(['customUserPrompt'], (localData) => {
            const data = { ...syncData, ...localData };

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
            enableSummariesToggle.checked = data.enableSummaries !== false;
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
                openaiApiKeyInput.addEventListener('input', () => {
                    chrome.storage.sync.set({ openaiApiKey: openaiApiKeyInput.value.trim() }, () => {
                        log.debug('Saved OpenAI API key');
                    });
                });
            }

            const customUserPromptInput = document.getElementById('customUserPrompt');
            if (customUserPromptInput) {
                if (!customUserPromptInput.value) {
                    customUserPromptInput.value = data.customUserPrompt || '';
                }

                const savePrompt = (() => {
                    let timeout;
                    return () => {
                        clearTimeout(timeout);
                        timeout = setTimeout(() => {
                            const trimmed = customUserPromptInput.value.trim();
                            chrome.storage.local.set({ customUserPrompt: trimmed }, () => {
                                if (chrome.runtime.lastError) {
                                    console.error('[ERROR] Failed to save prompt:', chrome.runtime.lastError.message);
                                } else {
                                    console.log('[DEBUG] Saved custom user prompt');
                                }
                            });
                        }, 300);
                    };
                })();

                applyInputDirection(customUserPromptInput);
                customUserPromptInput.addEventListener('input', () => {
                    applyInputDirection(customUserPromptInput);
                    savePrompt();
                });
            }
        });
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
            applyInputDirection(domainInput);
        });
        applyInputDirection(domainInput);

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
        removeButton.innerHTML = '&times;';
        removeButton.setAttribute('aria-label', 'Remove domain');
        removeButton.title = 'Remove domain';
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

    // === Helper: Auto-detect and apply RTL or LTR direction ===
    function applyInputDirection(input) {
        const rtlChars = /[\u0590-\u05FF\u0600-\u06FF]/; // Hebrew + Arabic
        const direction = rtlChars.test(input.value) ? 'rtl' : 'ltr';
        input.setAttribute('dir', direction);
    }

    function showConfirmationDialog(messageHtml, onConfirm) {
        const overlay = document.getElementById('dialog-overlay');
        const message = document.getElementById('dialog-message');
        const closeBtn = document.getElementById('dialog-close');
        const cancelBtn = document.getElementById('dialog-cancel');
        const confirmBtn = document.getElementById('dialog-confirm');

        message.innerHTML = messageHtml;
        overlay.style.display = 'flex';

        function cleanup() {
            overlay.style.display = 'none';
            closeBtn.removeEventListener('click', hide);
            cancelBtn.removeEventListener('click', hide);
            confirmBtn.removeEventListener('click', confirm);
            overlay.removeEventListener('click', onOverlayClick);
        }

        function hide() {
            cleanup();
        }

        function confirm() {
            cleanup();
            onConfirm();
        }

        function onOverlayClick(e) {
            if (e.target === overlay) hide();
        }

        closeBtn.addEventListener('click', hide);
        cancelBtn.addEventListener('click', hide);
        confirmBtn.addEventListener('click', confirm);
        overlay.addEventListener('click', onOverlayClick);
    }

    function triggerPoofEffect() {
        const audio = document.getElementById('poof-audio');

        if (audio) {
            audio.currentTime = 0;
            audio.play().catch(e => console.warn('Poof sound error:', e));
        }
    }
});
