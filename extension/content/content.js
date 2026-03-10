(function () {
    if (window.__enhancedConfluenceContentV2BootstrapLoaded) return;
    window.__enhancedConfluenceContentV2BootstrapLoaded = true;

    import(chrome.runtime.getURL('content/content-main.js'))
        .then((module) => {
            if (typeof module.bootstrapContentApp === 'function') {
                module.bootstrapContentApp();
            } else {
                console.error('[Content V2] bootstrapContentApp export not found.');
            }
        })
        .catch((error) => {
            console.error('[Content V2] Failed to load content app:', error);
        });
})();
