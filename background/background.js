// Listen for messages from content scripts or other parts of the extension
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'openTab') {
        chrome.tabs.create({ url: request.url });
    }
});

// Listen for tab updates to inject content scripts dynamically
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') return;

    // Retrieve user-configured domain settings from storage
    chrome.storage.sync.get('domainSettings', (data) => {
        if (data.domainSettings && data.domainSettings.length > 0) {
            const url = new URL(tab.url);
            const matchingSetting = data.domainSettings.find(entry => url.hostname.includes(entry.domain));
            if (matchingSetting) {
                const origin = `*://${matchingSetting.domain}/*`;

                // Check if we have permission
                chrome.permissions.contains({ origins: [origin] }, (hasPermission) => {
                    if (hasPermission) {
                        // Inject the content script into the tab
                        chrome.scripting.executeScript({
                            target: { tabId: tabId },
                            files: ['content/content.js']
                        });
                    } else {
                        console.log('No permission for domain:', matchingSetting.domain);
                    }
                });
            }
        }
    });
});
