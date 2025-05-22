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
        const url = `${chrome.runtime.getURL('results/results.html')}?searchText=${encodeURIComponent(request.searchText)}&baseUrl=${encodeURIComponent(request.baseUrl)}`;
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