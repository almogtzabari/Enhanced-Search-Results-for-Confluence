/**
 * options.js
 * Updated for Enhanced Search Results for Confluence
 * Compatible with DB_VERSION = 3 and store names 'summaries', 'conversations'
 */

const DB_NAME = 'ConfluenceSummariesDB';
const DB_VERSION = 3;
const SUMMARY_STORE = 'summaries';
const CONVERSATION_STORE = 'conversations';

document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    const saveBtn = $('save');
    const addDomainBtn = $('addDomain');
    const domainContainer = $('domainSettings');
    const darkModeToggle = $('darkModeToggle');
    const tooltipToggle = $('tooltipToggle');
    const enableSummariesToggle = $('enableSummariesToggle');
    const openaiApiKeyInput = $('openaiApiKey');
    const customApiEndpointInput = $('customApiEndpoint');
    const resultsPerRequestSelect = $('resultsPerRequest');
    const userPromptInput = $('customUserPrompt');
    const status = $('status');
    const clearSummaries = $('clearSummaries');
    const clearConversations = $('clearConversations');

    const showStatus = (msg, type) => {
        const icon = type === 'success' ? '✅' : '⚠️';
        status.innerHTML = `${icon} ${msg}`;
        status.className = `status ${type}`;
    };

    const isValidDomain = domain =>
        /^(?!:\/\/)([a-zA-Z0-9-_]+\.)*[a-zA-Z0-9][a-zA-Z0-9-_]+\.[a-zA-Z]{2,11}?$/.test(domain);

    const isValidInputId = id => /^[a-zA-Z0-9-_]+$/.test(id);

    const applyDir = input => {
        const rtl = /[\u0590-\u05FF\u0600-\u06FF]/;
        input.setAttribute('dir', rtl.test(input.value) ? 'rtl' : 'ltr');
    };

    const addDomainEntry = (domain = '', id = '') => {
        const div = document.createElement('div');
        div.className = 'domain-entry';

        const domainInput = document.createElement('input');
        domainInput.className = 'domain-input';
        domainInput.placeholder = 'Domain (e.g., example.com)';
        domainInput.value = domain;
        domainInput.addEventListener('input', () => {
            applyDir(domainInput);
            saveBtn.disabled = false;
        });
        applyDir(domainInput);

        const idInput = document.createElement('input');
        idInput.className = 'search-input-id-input';
        idInput.placeholder = 'Search input ID';
        idInput.value = id;
        idInput.addEventListener('input', () => (saveBtn.disabled = false));

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-domain';
        removeBtn.innerHTML = '&times;';
        removeBtn.onclick = () => {
            domainContainer.removeChild(div);
            saveBtn.disabled = false;
        };

        div.append(domainInput, idInput, removeBtn);
        domainContainer.appendChild(div);
    };

    const saveDomains = () => {
        const entries = domainContainer.querySelectorAll('.domain-entry');
        const domainSettings = [];

        for (const entry of entries) {
            const domain = entry.querySelector('.domain-input').value.trim();
            const id = entry.querySelector('.search-input-id-input').value.trim() || 'search-filter-input';

            if (!isValidDomain(domain) || !isValidInputId(id)) {
                showStatus('Invalid domain or input ID.', 'error');
                return;
            }
            domainSettings.push({ domain, searchInputId: id });
        }

        const isFirefox = typeof InstallTrigger !== 'undefined';
        const save = () => {
            chrome.storage.sync.set({ domainSettings }, () => {
                showStatus('Settings saved.', 'success');
                saveBtn.disabled = true;
            });
        };

        if (isFirefox || !chrome.permissions?.request) return save();

        const origins = domainSettings.map(d => `*://${d.domain}/*`);
        chrome.permissions.request({ origins }, granted => {
            if (granted) return save();
            showStatus('Permission denied for some domains.', 'error');
        });
    };

    const openDb = () =>
        new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => resolve(req.result);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(SUMMARY_STORE))
                    db.createObjectStore(SUMMARY_STORE, { keyPath: ['contentId', 'baseUrl'] });
                if (!db.objectStoreNames.contains(CONVERSATION_STORE))
                    db.createObjectStore(CONVERSATION_STORE, { keyPath: ['contentId', 'baseUrl'] });
            };
        });

    const clearStores = (stores, onDone) => {
        openDb()
            .then(db => {
                const tx = db.transaction(stores, 'readwrite');
                let done = 0;
                stores.forEach(storeName => {
                    const req = tx.objectStore(storeName).clear();
                    req.onsuccess = () => { if (++done === stores.length) onDone(); };
                    req.onerror = () => showStatus(`Failed to clear ${storeName}`, 'error');
                });
            })
            .catch(() => showStatus('Failed to open DB.', 'error'));
    };

    const confirm = (msg, cb) => {
        const overlay = $('dialog-overlay');
        const msgBox = $('dialog-message');
        msgBox.innerHTML = msg;
        overlay.style.display = 'flex';
        const cleanup = () => (overlay.style.display = 'none');
        $('dialog-confirm').onclick = () => { cleanup(); cb(); };
        $('dialog-cancel').onclick = cleanup;
        $('dialog-close').onclick = cleanup;
        overlay.onclick = e => { if (e.target === overlay) cleanup(); };
    };

    const poof = () => {
        const audio = $('poof-audio');
        if (audio) audio.play().catch(() => { });
    };

    addDomainBtn.onclick = () => {
        addDomainEntry();
        saveBtn.disabled = false;
    };

    saveBtn.onclick = saveDomains;

    darkModeToggle.onchange = () => {
        const isDark = darkModeToggle.checked;
        document.body.classList.toggle('dark-mode', isDark);
        chrome.storage.sync.set({ darkMode: isDark });
    };

    tooltipToggle.onchange = () => {
        chrome.storage.sync.set({ showTooltips: tooltipToggle.checked });
    };

    enableSummariesToggle.onchange = () => {
        chrome.storage.sync.set({ enableSummaries: enableSummariesToggle.checked });
    };

    openaiApiKeyInput.oninput = () => {
        chrome.storage.sync.set({ openaiApiKey: openaiApiKeyInput.value.trim() });
    };

    customApiEndpointInput.oninput = () => {
        chrome.storage.sync.set({ customApiEndpoint: customApiEndpointInput.value.trim() });
    };

    userPromptInput.oninput = (() => {
        let t;
        return () => {
            clearTimeout(t);
            t = setTimeout(() => {
                chrome.storage.local.set({ customUserPrompt: userPromptInput.value.trim() });
            }, 300);
        };
    })();

    resultsPerRequestSelect.onchange = () => {
        const val = parseInt(resultsPerRequestSelect.value, 10);
        chrome.storage.sync.set({ resultsPerRequest: val });
    };

    clearSummaries.onclick = () => {
        confirm(
            '<h2>Are you sure you want to delete all AI summaries and conversations?</h2>This cannot be undone.',
            () => {
                poof();
                clearStores([SUMMARY_STORE, CONVERSATION_STORE], () => {
                    showStatus('All summaries and conversations cleared.', 'success');
                    chrome.runtime.sendMessage({ action: 'summariesCleared' });
                });
            }
        );
    };

    clearConversations.onclick = () => {
        confirm(
            '<h2>Are you sure you want to delete all saved follow-up Q&A?</h2>This cannot be undone.',
            () => {
                poof();
                clearStores([CONVERSATION_STORE], () => {
                    showStatus('Conversations cleared.', 'success');
                });
            }
        );
    };

    $('advancedSettingsToggle').onclick = () => {
        const content = $('advancedSettingsContent');
        const shown = content.style.display === 'block';
        content.style.display = shown ? 'none' : 'block';
        $('advancedSettingsToggle').textContent = `Advanced Settings ${shown ? '▸' : '▾'}`;
    };

    chrome.storage.sync.get(
        ['domainSettings', 'darkMode', 'showTooltips', 'enableSummaries', 'openaiApiKey', 'customApiEndpoint', 'resultsPerRequest'],
        data => {
            chrome.storage.local.get(['customUserPrompt'], local => {
                const merged = { ...data, ...local };
                if (merged.domainSettings?.length) {
                    merged.domainSettings.forEach(({ domain, searchInputId }) => addDomainEntry(domain, searchInputId));
                } else {
                    addDomainEntry();
                }
                darkModeToggle.checked = !!merged.darkMode;
                tooltipToggle.checked = merged.showTooltips !== false;
                enableSummariesToggle.checked = merged.enableSummaries !== false;
                openaiApiKeyInput.value = merged.openaiApiKey || '';
                customApiEndpointInput.value = merged.customApiEndpoint || '';
                userPromptInput.value = merged.customUserPrompt || '';
                applyDir(userPromptInput);
                if (merged.resultsPerRequest) {
                    resultsPerRequestSelect.value = String(merged.resultsPerRequest);
                }
                if (merged.darkMode) document.body.classList.add('dark-mode');
            });
        }
    );
});
