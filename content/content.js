(function () {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', maybeInit);
    } else {
        maybeInit();
    }

    function maybeInit() {
        chrome.storage.sync.get(['enableFloatingSummarize'], ({ enableFloatingSummarize }) => {
            if (enableFloatingSummarize !== false) init();
        });
    }

    function init() {
        // Creates a floating button in the bottom-right corner of the page
        addFloatingButton();

        let searchInputId = 'search-filter-input'; // Default search input ID

        // Retrieve domain-specific settings from Chrome storage
        chrome.storage.sync.get(['domainSettings'], ({ domainSettings = [] }) => {
            const match = domainSettings.find((e) => window.location.hostname.includes(e.domain));
            if (match) {
                searchInputId = match.searchInputId || searchInputId;
                waitForInput();
            }
        });

        // Opens a new tab with search results or an empty input for user queries
        function executeSearch(initial = '') {
            let text = initial;
            const input = document.getElementById(searchInputId);
            if (!text && input) text = input.value.trim();

            const baseUrl = new URL(window.location.href).origin;
            chrome.runtime.sendMessage({
                action: 'openSearchTab',
                searchText: text,
                baseUrl: baseUrl
            });

        }

        // Monitors the DOM for the search input and adds the Enhanced Search button
        function waitForInput() {
            const observer = new MutationObserver(() => {
                const input = document.getElementById(searchInputId);
                if (input && !document.getElementById('enhanced-search-button')) {
                    addEnhancedButton(input);
                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            executeSearch();
                        }
                    });
                    observer.disconnect(); // Stop observing once input is initialized
                }
            });

            // Observe changes in the DOM to detect the search input
            observer.observe(document.body, { childList: true, subtree: true });

            // Check if the search input is already present
            const input = document.getElementById(searchInputId);
            if (input && !document.getElementById('enhanced-search-button')) {
                addEnhancedButton(input);
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        executeSearch();
                    }
                });
            }
        }

        // Creates and styles the Enhanced Search button, then appends it next to the search input
        function addEnhancedButton(input) {
            if (document.getElementById('enhanced-search-button')) return;

            const btn = document.createElement('button');
            btn.id = 'enhanced-search-button';
            btn.textContent = '🔍 Enhanced Search';

            const h = input.offsetHeight || 28;
            Object.assign(btn.style, {
                marginLeft: '8px',
                height: `${h}px`,
                padding: '0 12px',
                borderRadius: '3px',
                border: '1px solid #0052CC',
                background: '#0052CC',
                color: '#FFF',
                fontSize: '12px',
                lineHeight: `${h}px`,
                cursor: 'pointer',
            });

            btn.addEventListener('click', () => executeSearch());
            input.insertAdjacentElement('afterend', btn);
        }
    }

    // Creates a floating button in the bottom-right corner of the page
    async function addFloatingButton() {
        if (document.getElementById('enhanced-search-float')) return;

        const floatBtn = document.createElement('button');
        floatBtn.id = 'enhanced-search-float';
        floatBtn.textContent = '🧠 Summarize';
        Object.assign(floatBtn.style, {
            position: 'fixed',
            bottom: '50px',
            right: '20px',
            zIndex: '10000',
            padding: '10px 14px',
            fontSize: '14px',
            backgroundColor: '#0052CC',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
        });
        floatBtn.classList.add('summarize-button');

        floatBtn.addEventListener('click', async () => {
            if (floatBtn.classList.contains('loading')) return;
            floatBtn.textContent = 'Summarizing...';
            floatBtn.classList.add('loading');
            try {
                injectModalHtml();
                await launchAiModalForPage();
            } catch (err) {
                floatBtn.textContent = '🧠 Summarize';
            } finally {
                floatBtn.classList.remove('loading');
                floatBtn.disabled = false;
            }
        });

        document.body.appendChild(floatBtn);

        const contentId = await extractContentIdFromUrl(window.location.pathname);
        const baseUrl = new URL(window.location.href).origin;
        checkStoredSummaryStatus(contentId, baseUrl, floatBtn);
    }

    function injectModalHtml() {
        if (document.getElementById('summary-modal')) return;

        if (!document.getElementById('poof-audio')) {
            const audio = document.createElement('audio');
            audio.id = 'poof-audio';
            audio.src = chrome.runtime.getURL('assets/sounds/swoosh.mp3');
            audio.preload = 'auto';
            document.body.appendChild(audio);
        }

        const styleLink = document.createElement('link');
        styleLink.id = 'embedded-ai-modal-style';
        styleLink.rel = 'stylesheet';
        styleLink.href = chrome.runtime.getURL('content/modalStyles.css');
        document.head.appendChild(styleLink);

        const modalWrapper = document.createElement('div');
        modalWrapper.innerHTML = `
        <div id="summary-modal" class="modal-overlay" style="display: none;">
            <div class="modal-content" id="resizable-modal">
                <div class="modal-resizer" id="modal-resizer-left"></div>
                <div class="modal-resizer" id="modal-resizer"></div>
                <span class="modal-close" id="modal-close">&times;</span>
                <div id="summary-title"></div>
                <div id="modal-body" class="modal-body">
                    <div id="summary-content"></div>
                    <div id="qa-thread"></div>
                    <div id="qa-input-area">
                        <div class="qa-input-wrapper">
                            <div class="textarea-resizer" id="qa-resizer"></div>
                            <textarea id="qa-input" placeholder="Ask a follow-up question..."></textarea>
                        </div>
                        <button id="qa-submit">Ask</button>
                        <div id="qa-loading" style="display: none;">Answering...</div>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.appendChild(modalWrapper);
    }

    // Launch AI modal summarizing the current Confluence page
    async function launchAiModalForPage() {
        const contentId = await extractContentIdFromUrl(window.location.pathname);
        if (!contentId) {
            alert('Cannot determine content ID from URL.');
            return;
        }

        try {
            const [
                { getUserPrompt, handleQaSubmit },
                { fetchConfluenceBodyById, sendOpenAIRequest },
                { getStoredSummary, getStoredConversation, storeSummary, storeConversation },
                { showSummaryModal },
                { summarySystemPrompt, qaSystemPrompt }
            ] = await Promise.all([
                import(chrome.runtime.getURL('views/features/aiFeatures.js')),
                import(chrome.runtime.getURL('views/services/apiService.js')),
                import(chrome.runtime.getURL('views/services/dbService.js')),
                import(chrome.runtime.getURL('views/ui/modalManager.js')),
                import(chrome.runtime.getURL('views/config.js'))
            ]);

            const baseUrl = new URL(window.location.href).origin;
            const { setBaseUrl } = await import(chrome.runtime.getURL('views/state.js'));
            setBaseUrl(baseUrl);

            const metadataResponse = await fetch(`${baseUrl}/rest/api/content/${contentId}?expand=space,history.createdBy,version`);
            const metadataJson = await metadataResponse.json();

            const pageData = {
                id: contentId,
                title: metadataJson.title || document.title,
                _links: metadataJson._links || { webui: window.location.pathname },
                history: metadataJson.history || {},
                version: metadataJson.version || {},
                space: metadataJson.space || {},
                type: metadataJson.type || 'page'
            };


            const bodyHtml = await fetchConfluenceBodyById(contentId);
            let storedSummary = await getStoredSummary(contentId, baseUrl);
            const summaryExisted = !!storedSummary?.summaryHtml;   // ⬅️  was a summary already cached?
            let summary = storedSummary?.summaryHtml;
            let conversation = null;

            if (!summary) {
                const userPrompt = await getUserPrompt(pageData);
                const { openaiApiKey, customApiEndpoint } = await new Promise(res => chrome.storage.sync.get(['openaiApiKey', 'customApiEndpoint'], res));
                if (!openaiApiKey) {
                    alert('An OpenAI API key is required to generate summaries. Please configure it in the extension options.');
                    const floatBtn = document.getElementById('enhanced-search-float');
                    if (floatBtn) {
                        floatBtn.textContent = '🧠 Summarize';
                        floatBtn.classList.remove('loading');
                        floatBtn.disabled = false;
                    }
                    return;
                }

                const { selectedAiModel } = await new Promise(res => chrome.storage.sync.get(['selectedAiModel'], res));
                const model = selectedAiModel || 'gpt-4o';
                const result = await sendOpenAIRequest({
                    apiKey: openaiApiKey,
                    apiUrl: customApiEndpoint?.trim() || 'https://api.openai.com/v1/chat/completions',
                    model,
                    messages: [

                        { role: 'system', content: summarySystemPrompt },
                        { role: 'user', content: userPrompt }
                    ]
                });

                summary = result.choices?.[0]?.message?.content || '[No response]';
                await storeSummary({ contentId, baseUrl, title: pageData.title, summaryHtml: summary, bodyHtml });

                storedSummary = { summaryHtml: summary };
            }

            if (!conversation) {
                const storedConv = await getStoredConversation(contentId, baseUrl);
                if (storedConv?.messages) {
                    conversation = storedConv.messages;
                } else {
                    const userPrompt = await getUserPrompt(pageData);
                    conversation = [
                        { role: 'system', content: qaSystemPrompt },
                        { role: 'user', content: userPrompt },
                        { role: 'assistant', content: summary }
                    ];
                    await storeConversation(contentId, baseUrl, conversation);
                }
            }

            const { autoOpenSummary } = await new Promise(res =>
                chrome.storage.sync.get(['autoOpenSummary'], res)
            );
            if (autoOpenSummary === true || summaryExisted) {
                await showSummaryModal(summary, pageData, bodyHtml, baseUrl);
            }

            const floatBtn = document.getElementById('enhanced-search-float');
            if (floatBtn) {
                floatBtn.textContent = '✅ Summary Available!';
                floatBtn.classList.remove('loading');
                floatBtn.disabled = false;
            }

            const inputEl = document.getElementById('qa-input');
            const threadEl = document.getElementById('qa-thread');
            const submitBtn = document.getElementById('qa-submit');

            if (inputEl && threadEl && submitBtn) {
                submitBtn.onclick = () => handleQaSubmit(contentId, inputEl, threadEl, submitBtn, conversation);
                inputEl.onkeydown = (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleQaSubmit(contentId, inputEl, threadEl, submitBtn, conversation);
                    }
                };
            }

        } catch (err) {
            // show the exact reason we got back (falls back to the generic string)
            const msg = err?.message || 'Failed to generate or load summary.';
            console.error('[AI Modal] Failed to summarize page:', msg);
            alert(msg);

            // propagate so the outer <button> handler can reset its UI
            throw err;
        }

        const { setupModalResizers } = await import(chrome.runtime.getURL('views/ui/modalManager.js'));
        setupModalResizers();
    }

    async function extractContentIdFromUrl(pathname) {
        // Attempt to extract pageId from URL query parameters
        const pageIdMatch = window.location.search.match(/pageId=(\d+)/);
        if (pageIdMatch) return pageIdMatch[1];

        // Attempt to extract pageId from meta tag
        const meta = document.querySelector('meta[name="ajs-page-id"]');
        if (meta) return meta.getAttribute('content');

        // Attempt to extract pageId from AJS.params
        if (window.AJS?.params?.pageId) return window.AJS.params.pageId;

        // Attempt to extract pageId from URL path
        const pathMatch = pathname.match(/\/pages\/viewpage\.action\?pageId=(\d+)/);
        if (pathMatch) return pathMatch[1];

        // Attempt to extract spaceKey and title from /display/SPACEKEY/Page+Title URL
        const displayMatch = pathname.match(/^\/display\/([^/]+)\/(.+)$/);
        if (displayMatch) {
            const spaceKey = decodeURIComponent(displayMatch[1]);
            const title = decodeURIComponent(displayMatch[2].replace(/\+/g, ' '));

            // Use Confluence REST API to get pageId
            try {
                const response = await fetch(`${window.location.origin}/rest/api/content?spaceKey=${encodeURIComponent(spaceKey)}&title=${encodeURIComponent(title)}`);
                if (!response.ok) throw new Error('Failed to fetch page data');
                const data = await response.json();
                const page = data.results?.[0];
                if (page?.id) return page.id;
            } catch (error) {
                console.error('Error fetching page ID:', error);
            }
        }

        // If all methods fail, return null
        return null;
    }

    async function checkStoredSummaryStatus(contentId, baseUrl, floatBtn) {
        if (!contentId) return;
        try {
            const { getStoredSummary } = await import(chrome.runtime.getURL('views/services/dbService.js'));
            const stored = await getStoredSummary(contentId, baseUrl);
            if (stored?.summaryHtml) {
                floatBtn.textContent = '✅ Summary Available!';
            }
        } catch (err) {
            console.error('Failed to check stored summary:', err);
        }
    }
})();