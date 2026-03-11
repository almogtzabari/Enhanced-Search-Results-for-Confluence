const DEBUG = false;
const DB_NAME = 'ConfluenceSummariesDB';
const DB_VERSION = 5;
const SUMMARY_STORE = 'summaries';
const CONVERSATION_STORE = 'conversations';
const SAVED_SEARCH_STORE = 'saved_searches';

const log = {
    debug: (...args) => DEBUG && console.debug('[DEBUG]', ...args),
    info: (...args) => console.info('[INFO]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
};

const grantedDomains = new Set();
let domainSettingsCache = [];
let domainSettingsCacheReady = false;
let domainSettingsLoadPromise = null;
let dbPromise = null;

function hasOptionalOriginPermissions(entries) {
    if (!Array.isArray(entries)) return false;
    return entries.some((entry) => (
        typeof entry === 'string'
        && (entry === '<all_urls>' || entry.includes('://'))
    ));
}

function supportsDynamicOriginPermissionRequests() {
    if (!chrome.permissions || !chrome.permissions.contains || !chrome.permissions.request) {
        return false;
    }
    const manifest = chrome.runtime?.getManifest?.();
    if (!manifest || typeof manifest !== 'object') {
        return false;
    }
    const mv = Number(manifest.manifest_version || 0);
    if (mv >= 3) {
        return hasOptionalOriginPermissions(manifest.optional_host_permissions);
    }
    return hasOptionalOriginPermissions(manifest.optional_permissions);
}

function normalizeHost(value) {
    return String(value || '').trim().toLowerCase().replace(/\.+$/, '');
}

function hostnameMatchesDomain(hostname, domain) {
    const host = normalizeHost(hostname);
    const target = normalizeHost(domain);
    if (!host || !target) return false;
    return host === target || host.endsWith(`.${target}`);
}

function normalizeDomainSettingsEntries(entries) {
    if (!Array.isArray(entries)) return [];
    return [...new Set(entries
        .map((entry) => normalizeHost(entry?.domain))
        .filter(Boolean))];
}

function setDomainSettingsCache(entries) {
    domainSettingsCache = normalizeDomainSettingsEntries(entries);
    domainSettingsCacheReady = true;
    return domainSettingsCache;
}

function loadDomainSettingsCache() {
    if (domainSettingsLoadPromise) return domainSettingsLoadPromise;

    domainSettingsLoadPromise = new Promise((resolve) => {
        chrome.storage.sync.get('domainSettings', (data) => {
            const error = chrome.runtime?.lastError;
            if (error) {
                log.error('Failed to load domain settings cache:', error.message || error);
                domainSettingsCacheReady = true;
                const fallbackDomains = domainSettingsCache;
                domainSettingsLoadPromise = null;
                resolve(fallbackDomains);
                return;
            }

            const nextDomains = setDomainSettingsCache(data?.domainSettings);
            domainSettingsLoadPromise = null;
            resolve(nextDomains);
        });
    });

    return domainSettingsLoadPromise;
}

function withDomainSettingsCache(handler) {
    if (domainSettingsCacheReady) {
        handler(domainSettingsCache);
        return;
    }

    loadDomainSettingsCache().then((domains) => {
        handler(domains);
    });
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.domainSettings) return;
    setDomainSettingsCache(changes.domainSettings.newValue);
});

// Preload cache on service worker startup to avoid repeated sync reads on first tab updates.
loadDomainSettingsCache();

function injectContentScript(tabId) {
    if (chrome.scripting && typeof chrome.scripting.executeScript === 'function') {
        chrome.scripting.executeScript({
            target: { tabId },
            files: ['extension/content/content.js']
        }, () => {
            if (chrome.runtime.lastError) {
                log.error('Injection failed:', chrome.runtime.lastError);
            }
        });
        return;
    }

    if (chrome.tabs && typeof chrome.tabs.executeScript === 'function') {
        chrome.tabs.executeScript(tabId, {
            file: 'extension/content/content.js'
        }, () => {
            if (chrome.runtime.lastError) {
                log.error('Injection failed:', chrome.runtime.lastError);
            }
        });
        return;
    }

    log.error('No supported script injection API found for this browser/runtime.');
}

// Listen for messages from content scripts or other parts of the extension
chrome.runtime.onMessage.addListener(function (request) {
    if (request.action === 'openTab') {
        chrome.tabs.create({ url: request.url });
    } else if (request.action === 'openSearchTab') {
        const params = new URLSearchParams({
            searchText: String(request.searchText || ''),
            baseUrl: String(request.baseUrl || '')
        });
        if (request.focusSearch) {
            params.set('focusSearch', '1');
        }
        const url = `${chrome.runtime.getURL('views/index.html')}?${params.toString()}`;
        chrome.tabs.create({ url });
    }
});

if (chrome.runtime?.onInstalled?.addListener) {
    chrome.runtime.onInstalled.addListener((details) => {
        if (!details || (details.reason !== 'install' && details.reason !== 'update')) return;

        const fallbackOpenOptionsTab = () => {
            try {
                chrome.tabs?.create?.({ url: chrome.runtime.getURL('options/options.html') });
            } catch (err) {
                log.error('Failed to open options page on install/update:', err);
            }
        };

        if (chrome.runtime?.openOptionsPage) {
            chrome.runtime.openOptionsPage(() => {
                if (chrome.runtime?.lastError) {
                    fallbackOpenOptionsTab();
                }
            });
            return;
        }

        fallbackOpenOptionsTab();
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.action !== 'ensureApiOriginPermission') return;

    let origin = '';
    try {
        origin = new URL(String(request.origin || '')).origin;
    } catch {
        sendResponse({ granted: false, error: 'Invalid API origin' });
        return false;
    }

    ensureOriginPermission(origin, {
        requestIfMissing: request?.requestIfMissing !== false
    })
        .then((result) => {
            sendResponse({
                granted: !!result.granted,
                error: result.error || ''
            });
        })
        .catch((err) => {
            sendResponse({
                granted: false,
                error: err?.message || 'Failed to request endpoint permission'
            });
        });

    return true;
});


// Listen for tab updates to inject content scripts dynamically
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') return;

    const tabUrl = typeof tab?.url === 'string' ? tab.url : '';
    if (!tabUrl) return;

    let url;
    try {
        url = new URL(tabUrl);
    } catch {
        return;
    }

    if (!/^https?:$/.test(url.protocol)) return;

    withDomainSettingsCache((domains) => {
        if (!Array.isArray(domains) || domains.length === 0) return;

        const matchedDomain = domains.find((domain) => hostnameMatchesDomain(url.hostname, domain));
        if (!matchedDomain) return;

        const origin = `*://${matchedDomain}/*`;

        if (chrome.permissions && chrome.permissions.contains) {
            if (grantedDomains.has(origin)) {
                injectContentScript(tabId);
            } else {
                chrome.permissions.contains({ origins: [origin] }, (hasPermission) => {
                    const permissionError = chrome.runtime?.lastError;
                    if (permissionError) {
                        log.error(`Permission check failed for ${origin}:`, permissionError.message || permissionError);
                        return;
                    }
                    log.debug(`Permission check for ${origin}:`, hasPermission);
                    if (hasPermission) {
                        grantedDomains.add(origin);
                        injectContentScript(tabId);
                    } else {
                        log.debug('No permission for domain:', matchedDomain);
                    }
                });
            }
            return;
        }

        // Fallback path for runtimes that do not expose optional-host permission checks.
        injectContentScript(tabId);
    });
});

function openDb() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        try {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = () => {
                dbPromise = null;
                reject(request.error);
            };
            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => {
                    try {
                        db.close();
                    } catch {
                        // ignore close errors
                    }
                    dbPromise = null;
                };
                db.onclose = () => {
                    dbPromise = null;
                };
                resolve(db);
            };
            request.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(SUMMARY_STORE))
                    db.createObjectStore(SUMMARY_STORE, { keyPath: ['contentId', 'baseUrl'] });
                if (!db.objectStoreNames.contains(CONVERSATION_STORE))
                    db.createObjectStore(CONVERSATION_STORE, { keyPath: ['contentId', 'baseUrl'] });
                if (!db.objectStoreNames.contains(SAVED_SEARCH_STORE))
                    db.createObjectStore(SAVED_SEARCH_STORE, { keyPath: 'id' });
            };
        } catch (err) {
            dbPromise = null;
            reject(err);
        }
    });

    return dbPromise;
}

function runDbActionWithConnection(db, store, mode, operation, payload) {
    return new Promise((resolve, reject) => {
        log.debug(`[DB] dbAction called with store="${store}", mode="${mode}", operation="${operation}"`);
        let tx;
        try {
            tx = db.transaction(store, mode);
        } catch (err) {
            const wrappedError = new Error(`Transaction failed: ${err.message}`);
            wrappedError.name = err?.name || wrappedError.name;
            wrappedError.cause = err;
            reject(wrappedError);
            return;
        }

        const os = tx.objectStore(store);
        let req;
        try {
            if (operation === 'put') req = os.put(payload);
            else if (operation === 'get') req = os.get(payload);
            else if (operation === 'getAll') req = os.getAll();
            else if (operation === 'clear') req = os.clear();
            else if (operation === 'delete') req = os.delete(payload);
            else {
                reject(new Error(`Unsupported operation: ${operation}`));
                return;
            }
        } catch (err) {
            reject(err);
            return;
        }

        tx.oncomplete = () => log.debug(`[DB] ${operation} complete on ${store}`);
        tx.onerror = () => {
            log.error(`[DB] Transaction error: ${tx.error?.message || 'unknown error'}`);
            reject(tx.error);
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function dbAction(store, mode, operation, payload) {
    return openDb()
        .then((db) => runDbActionWithConnection(db, store, mode, operation, payload))
        .catch((err) => {
            const retryable = err?.name === 'InvalidStateError';
            if (!retryable) throw err;
            dbPromise = null;
            return openDb().then((db) => runDbActionWithConnection(db, store, mode, operation, payload));
        });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg.dbAction) return;
    const { store, mode, op, payload } = msg;
    dbAction(store, mode, op, payload)
        .then(result => sendResponse({ success: true, result }))
        .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // keep message channel open
});

function buildResponsesPayload({ model, messages, reasoningEffort }) {
    const safeMessages = Array.isArray(messages) ? messages : [];
    let instructions = '';
    const input = [];

    safeMessages.forEach((msg) => {
        if (!msg || typeof msg.content !== 'string') return;
        const role = msg.role || 'user';

        // Use the first system message as Responses API instructions.
        if (!instructions && role === 'system') {
            instructions = msg.content;
            return;
        }

        if (role === 'assistant' || role === 'developer' || role === 'user') {
            input.push({ role, content: msg.content });
        } else {
            input.push({ role: 'user', content: msg.content });
        }
    });

    const payload = { model, input };
    if (instructions) payload.instructions = instructions;
    if (reasoningEffort) payload.reasoning = { effort: reasoningEffort };
    return payload;
}

function performOpenAIRequest({ apiKey, apiUrl, model, messages, reasoningEffort }, sendResponse) {
    (async () => {
        try {
            const payload = buildResponsesPayload({ model, messages, reasoningEffort });

            const res = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const text = await res.text();
                sendResponse({ success: false, error: `HTTP ${res.status}: ${text}` });
            } else {
                const data = await res.json();
                sendResponse({ success: true, data });
            }
        } catch (err) {
            sendResponse({ success: false, error: err.message });
        }
    })();
}

function normalizeResponsesUrl(apiUrl) {
    const fallback = 'https://api.openai.com/v1';
    let sanitizedBase = String(apiUrl || fallback).trim().replace(/\/+$/, '');
    if (!sanitizedBase) sanitizedBase = fallback;
    return /\/responses$/i.test(sanitizedBase) ? sanitizedBase : `${sanitizedBase}/responses`;
}

function ensureOriginPermission(origin, { requestIfMissing = true } = {}) {
    return new Promise((resolve) => {
        if (!supportsDynamicOriginPermissionRequests()) {
            resolve({ granted: true, error: '' });
            return;
        }

        const originPattern = `${origin}/*`;
        chrome.permissions.contains({ origins: [originPattern] }, (hasPermission) => {
            const containsError = chrome.runtime?.lastError;
            if (containsError) {
                resolve({
                    granted: false,
                    error: containsError.message || 'Failed to check endpoint permission'
                });
                return;
            }
            if (hasPermission) {
                resolve({ granted: true, error: '' });
                return;
            }

            if (!requestIfMissing) {
                resolve({ granted: false, error: 'Endpoint permission is missing' });
                return;
            }

            chrome.permissions.request({ origins: [originPattern] }, (granted) => {
                const requestError = chrome.runtime?.lastError;
                if (requestError) {
                    resolve({
                        granted: false,
                        error: requestError.message || 'Failed to request endpoint permission'
                    });
                    return;
                }
                if (!granted) {
                    resolve({ granted: false, error: 'Permission denied for custom endpoint' });
                    return;
                }

                chrome.permissions.contains({ origins: [originPattern] }, (verified) => {
                    const verifyError = chrome.runtime?.lastError;
                    if (verifyError) {
                        resolve({
                            granted: false,
                            error: verifyError.message || 'Failed to verify endpoint permission'
                        });
                        return;
                    }
                    if (verified) {
                        resolve({ granted: true, error: '' });
                    } else {
                        resolve({ granted: false, error: 'Permission was not granted for custom endpoint' });
                    }
                });
            });
        });
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.action !== 'validateOpenAiApiKey') return;

    const apiKey = String(request?.apiKey || '').trim();
    const inputApiUrl = String(request?.apiUrl || '').trim() || 'https://api.openai.com/v1';
    if (!apiKey) {
        sendResponse({ ok: false, valid: false, error: 'OpenAI API key is required' });
        return false;
    }

    let responsesUrl = '';
    let origin = '';
    try {
        responsesUrl = normalizeResponsesUrl(inputApiUrl);
        origin = new URL(responsesUrl).origin;
    } catch {
        sendResponse({ ok: false, valid: false, error: 'Invalid API URL' });
        return false;
    }

    ensureOriginPermission(origin, { requestIfMissing: true }).then(async (permission) => {
        if (!permission.granted) {
            sendResponse({
                ok: false,
                valid: false,
                error: permission.error || 'Permission denied for OpenAI endpoint'
            });
            return;
        }

        try {
            const res = await fetch(responsesUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: '{}'
            });

            if (res.status === 401 || res.status === 403) {
                sendResponse({
                    ok: true,
                    valid: false,
                    error: 'Authentication failed for the provided API key.'
                });
                return;
            }

            if (res.ok || res.status === 400 || res.status === 422) {
                sendResponse({ ok: true, valid: true, error: '' });
                return;
            }

            if (res.status === 404 || res.status === 405) {
                sendResponse({
                    ok: true,
                    valid: false,
                    error: 'Endpoint does not appear to support the Responses API.'
                });
                return;
            }

            const text = await res.text();
            sendResponse({
                ok: true,
                valid: false,
                error: `HTTP ${res.status}: ${text || 'Unexpected error from endpoint'}`
            });
        } catch (err) {
            sendResponse({
                ok: false,
                valid: false,
                error: err?.message || 'Failed to validate OpenAI API key'
            });
        }
    });

    return true;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'openaiRequest') {
        let origin = '';
        try {
            origin = new URL(msg.payload.apiUrl).origin;
        } catch {
            sendResponse({ success: false, error: 'Invalid API URL' });
            return false;
        }
        const senderUrl = String(sender?.url || '');

        if (senderUrl.startsWith('moz-extension://')) {
            // Block sendMessage from Firefox extension pages — use port instead
            sendResponse({ success: false, error: 'Use port-based connection for Firefox' });
            return false;
        }

        ensureOriginPermission(origin, { requestIfMissing: false }).then((result) => {
            if (!result.granted) {
                sendResponse({ success: false, error: result.error || 'Permission denied for custom endpoint' });
                return;
            }
            performOpenAIRequest(msg.payload, sendResponse);
        });

        return true;
    }
});

chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'openaiPort') return;

    let isConnected = true;
    let keepAliveTimer = null;
    let activeFetchController = null;

    const postToPort = (payload) => {
        if (!isConnected) return false;
        try {
            port.postMessage(payload);
            return true;
        } catch {
            return false;
        }
    };

    const clearKeepAlive = () => {
        if (!keepAliveTimer) return;
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
    };

    const startKeepAlive = () => {
        clearKeepAlive();
        keepAliveTimer = setInterval(() => {
            if (!postToPort({ keepAlive: true })) {
                clearKeepAlive();
            }
        }, 25000); // every 25s to avoid 30s timeout
    };

    const abortActiveFetch = () => {
        if (!activeFetchController) return;
        activeFetchController.abort();
        activeFetchController = null;
    };

    const cleanupConnection = () => {
        clearKeepAlive();
        abortActiveFetch();
    };

    port.onDisconnect.addListener(() => {
        isConnected = false;
        cleanupConnection();
    });

    port.onMessage.addListener((msg) => {
        const { apiKey, apiUrl, model, messages, reasoningEffort } = msg || {};
        (async () => {
            let origin;
            try {
                origin = new URL(apiUrl).origin;
            } catch {
                postToPort({ success: false, error: 'Invalid API URL' });
                return;
            }

            const permission = await ensureOriginPermission(origin, { requestIfMissing: false });
            if (!permission.granted) {
                postToPort({ success: false, error: permission.error || 'Permission denied for custom endpoint' });
                return;
            }
            if (!isConnected) return;

            abortActiveFetch();
            const fetchController = new AbortController();
            activeFetchController = fetchController;
            startKeepAlive();

            try {
                const payload = buildResponsesPayload({ model, messages, reasoningEffort });
                const res = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify(payload),
                    signal: fetchController.signal
                });

                if (!res.ok) {
                    const text = await res.text();
                    postToPort({ success: false, error: `HTTP ${res.status}: ${text}` });
                    return;
                }

                const data = await res.json();
                postToPort({ success: true, data });
            } catch (err) {
                if (err?.name === 'AbortError') return;
                postToPort({ success: false, error: err?.message || 'OpenAI request failed' });
            } finally {
                if (activeFetchController === fetchController) {
                    activeFetchController = null;
                }
                clearKeepAlive();
            }
        })();
    });
});
