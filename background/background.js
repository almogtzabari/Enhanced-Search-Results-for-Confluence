import {
    DB_NAME,
    DB_VERSION,
    SUMMARY_STORE_NAME as SUMMARY_STORE,
    CONVERSATION_STORE_NAME as CONVERSATION_STORE
} from '../views/config.js';

const DEBUG = false;
const log = {
    debug: (...args) => DEBUG && console.debug('[DEBUG]', ...args),
    error: (...args) => console.error('[ERROR]', ...args)
};

const grantedDomains = new Set();

// Detect Firefox
const isFirefox = typeof browser !== 'undefined' && typeof InstallTrigger !== 'undefined';

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
        const url = `${chrome.runtime.getURL('views/v2/index.html')}?${params.toString()}`;
        chrome.tabs.create({ url });
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.action !== 'ensureApiOriginPermission') return;

    let origin = '';
    try {
        origin = new URL(String(request.origin || '')).origin;
    } catch {
        sendResponse({ granted: false, error: 'Invalid API origin' });
        return false;
    }

    ensureOriginPermission(origin)
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

    chrome.storage.sync.get('domainSettings', (data) => {
        if (data.domainSettings && data.domainSettings.length > 0) {
            const url = new URL(tab.url);
            const matchingSetting = data.domainSettings.find(entry => url.hostname.includes(entry.domain));
            if (!matchingSetting) return;

            const origin = `*://${matchingSetting.domain}/*`;

            if (isFirefox) {
                // Firefox always uses tabs.executeScript (Manifest V2)
                chrome.tabs.executeScript(tabId, {
                    file: 'content/content.js'
                }, () => {
                    if (chrome.runtime.lastError) {
                        log.error('Injection failed:', chrome.runtime.lastError);
                    }
                });
            } else if (chrome.permissions && chrome.permissions.contains) {
                if (grantedDomains.has(origin)) {
                    chrome.scripting.executeScript({
                        target: { tabId },
                        files: ['content/content.js']
                    });
                } else {
                    chrome.permissions.contains({ origins: [origin] }, (hasPermission) => {
                        log.debug(`Permission check for ${origin}:`, hasPermission);
                        if (hasPermission) {
                            grantedDomains.add(origin);
                            chrome.scripting.executeScript({
                                target: { tabId },
                                files: ['content/content.js']
                            });
                        } else {
                            log.debug('No permission for domain:', matchingSetting.domain);
                        }
                    });
                }
            }
        }
    });
});

function openDb() {
    return new Promise((resolve, reject) => {
        try {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(SUMMARY_STORE))
                    db.createObjectStore(SUMMARY_STORE, { keyPath: ['contentId', 'baseUrl'] });
                if (!db.objectStoreNames.contains(CONVERSATION_STORE))
                    db.createObjectStore(CONVERSATION_STORE, { keyPath: ['contentId', 'baseUrl'] });
                if (!db.objectStoreNames.contains('saved_searches'))
                    db.createObjectStore('saved_searches', { keyPath: 'id' });
            };
        } catch (err) {
            reject(err);
        }
    });
}

function dbAction(store, mode, operation, payload) {
    return openDb().then(db => {
        log.debug(`[DB] dbAction called with store="${store}", mode="${mode}", operation="${operation}"`);
        return new Promise((resolve, reject) => {
            let tx;
            try {
                tx = db.transaction(store, mode);
            } catch (err) {
                return reject(new Error(`Transaction failed: ${err.message}`));
            }

            const os = tx.objectStore(store);
            let req;
            try {
                if (operation === 'put') req = os.put(payload);
                else if (operation === 'get') req = os.get(payload);
                else if (operation === 'getAll') req = os.getAll();
                else if (operation === 'clear') req = os.clear();
                else if (operation === 'delete') req = os.delete(payload);
                else return reject(new Error(`Unsupported operation: ${operation}`));
            } catch (err) {
                return reject(err);
            }

            tx.oncomplete = () => log.debug(`[DB] ${operation} complete on ${store}`);
            tx.onerror = () => {
                log.error(`[DB] Transaction error: ${tx.error?.message || 'unknown error'}`);
                reject(tx.error);
            };

            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
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

    safeMessages.forEach((msg, index) => {
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

function ensureOriginPermission(origin) {
    return new Promise((resolve) => {
        if (!chrome.permissions || !chrome.permissions.contains || !chrome.permissions.request) {
            resolve({ granted: true, error: '' });
            return;
        }

        const originPattern = `${origin}/*`;
        chrome.permissions.contains({ origins: [originPattern] }, (hasPermission) => {
            if (hasPermission) {
                resolve({ granted: true, error: '' });
                return;
            }

            chrome.permissions.request({ origins: [originPattern] }, (granted) => {
                if (!granted) {
                    resolve({ granted: false, error: 'Permission denied for custom endpoint' });
                    return;
                }

                chrome.permissions.contains({ origins: [originPattern] }, (verified) => {
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'openaiRequest') {
        const origin = new URL(msg.payload.apiUrl).origin;
        const isFirefox = typeof browser !== 'undefined' && typeof InstallTrigger !== 'undefined';

        if (isFirefox && sender?.url?.startsWith('chrome')) {
            // Block sendMessage from Firefox extension pages — use port instead
            sendResponse({ success: false, error: 'Use port-based connection for Firefox' });
            return false;
        }

        ensureOriginPermission(origin).then((result) => {
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
    if (port.name === 'openaiPort') {
        port.onMessage.addListener((msg) => {
            const { apiKey, apiUrl, model, messages, reasoningEffort } = msg;
            (async () => {
                let origin;
                try {
                    origin = new URL(apiUrl).origin;
                } catch {
                    port.postMessage({ success: false, error: 'Invalid API URL' });
                    return;
                }

                const permission = await ensureOriginPermission(origin);
                if (!permission.granted) {
                    port.postMessage({ success: false, error: permission.error || 'Permission denied for custom endpoint' });
                    return;
                }

                let keepAliveTimer = setInterval(() => {
                    port.postMessage({ keepAlive: true });
                }, 25000); // every 25s to avoid 30s timeout

                const payload = buildResponsesPayload({ model, messages, reasoningEffort });

                fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify(payload)
                })
                    .then(async (res) => {
                        clearInterval(keepAliveTimer);
                        if (!res.ok) {
                            const text = await res.text();
                            port.postMessage({ success: false, error: `HTTP ${res.status}: ${text}` });
                        } else {
                            const data = await res.json();
                            port.postMessage({ success: true, data });
                        }
                    })
                    .catch((err) => {
                        clearInterval(keepAliveTimer);
                        port.postMessage({ success: false, error: err.message });
                    });
            })();
        });
    }
});
