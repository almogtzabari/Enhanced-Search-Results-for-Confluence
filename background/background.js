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
        const url = `${chrome.runtime.getURL('views/index.html')}?searchText=${encodeURIComponent(request.searchText)}&baseUrl=${encodeURIComponent(request.baseUrl)}`;
        chrome.tabs.create({ url });
    }
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
            };
        } catch (err) {
            reject(err);
        }
    });
}


function dbAction(store, mode, operation, payload) {
    return openDb().then(db => {
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
                else if (operation === 'clear') req = os.clear();
                else return reject(new Error(`Unsupported operation: ${operation}`));
            } catch (err) {
                return reject(err);
            }

            tx.oncomplete = () => log.debug(`[DB] ${operation} complete on ${store}`);
            tx.onerror = () => log.error(`[DB] Transaction error: ${tx.error?.message || 'unknown error'}`);

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
