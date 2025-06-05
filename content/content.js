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

    // Function to inject CSS needed for the floating button early
    function injectFloatingButtonStyles() {
        if (document.getElementById('enhanced-content-script-styles')) return; // Prevent multiple injections
        const styleLink = document.createElement('link');
        styleLink.id = 'enhanced-content-script-styles';
        styleLink.rel = 'stylesheet';
        // Assuming modalStyles.css contains styles for floating button and modal
        styleLink.href = chrome.runtime.getURL('content/modalStyles.css');
        document.head.appendChild(styleLink);
    }

    function init() {
        injectFloatingButtonStyles(); // Inject styles early
        addFloatingButton();

        let searchInputId = 'search-filter-input'; // Default search input ID

        chrome.storage.sync.get(['domainSettings'], ({ domainSettings = [] }) => {
            const match = domainSettings.find((e) => window.location.hostname.includes(e.domain));
            if (match) {
                searchInputId = match.searchInputId || searchInputId;
                waitForInput();
            }
        });

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
                    observer.disconnect();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
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

    async function addFloatingButton() {
        if (document.getElementById('enhanced-search-float')) return;

        const floatBtn = document.createElement('button');
        floatBtn.id = 'enhanced-search-float';

        const textStates = {
            summarize: { icon: '🧠', full: '🧠 Summarize' },
            available: { icon: '✅', full: '✅ Summary Available!' },
            loading: { icon: '⏳', full: 'Summarizing...' }
        };

        const updateAppearance = (isHovering) => {
            const isLoading = floatBtn.dataset.loading === 'true';
            const isSummaryAvailable = floatBtn.dataset.summaryAvailable === 'true';

            if (isLoading) {
                floatBtn.textContent = textStates.loading.full;
                floatBtn.classList.add('float-btn-expanded', 'loading');
                floatBtn.classList.remove('float-btn-small');
                floatBtn.disabled = true;
            } else {
                floatBtn.classList.remove('loading');
                floatBtn.disabled = false;
                if (isHovering) {
                    floatBtn.textContent = isSummaryAvailable ? textStates.available.full : textStates.summarize.full;
                    floatBtn.classList.add('float-btn-expanded');
                    floatBtn.classList.remove('float-btn-small');
                } else {
                    floatBtn.textContent = isSummaryAvailable ? textStates.available.icon : textStates.summarize.icon;
                    floatBtn.classList.add('float-btn-small');
                    floatBtn.classList.remove('float-btn-expanded');
                }
            }
        };

        // Minimal inline styles, most styling handled by CSS classes
        Object.assign(floatBtn.style, {
            position: 'fixed',
            bottom: '50px',
            right: '20px',
            zIndex: '10000',
        });
        // Add a general class for the button, distinct from table/tree summarize buttons if needed for specificity
        floatBtn.classList.add('page-floating-summarize-btn');


        // Set initial data attributes BEFORE first updateAppearance call
        floatBtn.dataset.summaryAvailable = 'false';
        floatBtn.dataset.loading = 'false';

        document.body.appendChild(floatBtn);
        updateAppearance(false); // Set initial visual state (small, icon)

        floatBtn.addEventListener('mouseenter', () => updateAppearance(true));
        floatBtn.addEventListener('mouseleave', () => updateAppearance(false));

        floatBtn.addEventListener('click', async () => {
            if (floatBtn.dataset.loading === 'true') return;

            floatBtn.dataset.loading = 'true';
            updateAppearance(true);

            try {
                injectModalHtml(); // Ensures modal HTML and its specific styles are ready
                await launchAiModalForPage();
            } catch (err) {
                console.error('[Summarize Button] Unexpected error:', err);
                alert(`Failed to summarize the page.\n\nReason: ${err.message || 'Unknown error.'}`);
                floatBtn.dataset.summaryAvailable = 'false';
            } finally {
                floatBtn.dataset.loading = 'false';
                updateAppearance(floatBtn.matches(':hover'));
            }
        });

        const contentId = await extractContentIdFromUrl(window.location.pathname);
        const baseUrl = new URL(window.location.href).origin;
        checkStoredSummaryStatus(contentId, baseUrl, floatBtn, updateAppearance);
    }

    function injectModalHtml() {
        // This function now primarily ensures the modal structure is in the DOM when needed.
        // Styles for the floating button itself are injected by injectFloatingButtonStyles() earlier.
        // If modalStyles.css also contains modal-specific styles, this is fine.
        if (!document.getElementById('enhanced-content-script-styles')) {
            // Fallback: ensure styles are present if somehow missed by init (should not happen)
            const styleLink = document.createElement('link');
            styleLink.id = 'enhanced-content-script-styles';
            styleLink.rel = 'stylesheet';
            styleLink.href = chrome.runtime.getURL('content/modalStyles.css');
            document.head.appendChild(styleLink);
        }

        if (document.getElementById('summary-modal')) return;

        if (!document.getElementById('poof-audio')) {
            const audio = document.createElement('audio');
            audio.id = 'poof-audio';
            audio.src = chrome.runtime.getURL('assets/sounds/swoosh.mp3');
            audio.preload = 'auto';
            document.body.appendChild(audio);
        }

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

    async function launchAiModalForPage() {
        const contentId = await extractContentIdFromUrl(window.location.pathname);
        if (!contentId) {
            alert('Cannot determine content ID from URL.');
            // Ensure floatBtn state is reset if launchAiModalForPage is exited early
            const floatBtnForState = document.getElementById('enhanced-search-float');
            if (floatBtnForState) floatBtnForState.dataset.summaryAvailable = 'false';
            return;
        }

        const floatBtnForState = document.getElementById('enhanced-search-float');

        try {
            let getUserPrompt, handleQaSubmit, sendOpenAIRequest, getStoredSummary, getStoredConversation, storeSummary, storeConversation, showSummaryModal, summarySystemPrompt, qaSystemPrompt;
            try {
                const aiFeaturesM = await import(chrome.runtime.getURL('views/features/aiFeatures.js'));
                const apiServiceM = await import(chrome.runtime.getURL('views/services/apiService.js'));
                const dbServiceM = await import(chrome.runtime.getURL('views/services/dbService.js'));
                const modalManagerM = await import(chrome.runtime.getURL('views/ui/modalManager.js'));
                const configM = await import(chrome.runtime.getURL('views/config.js'));

                getUserPrompt = aiFeaturesM.getUserPrompt;
                handleQaSubmit = aiFeaturesM.handleQaSubmit;
                sendOpenAIRequest = apiServiceM.sendOpenAIRequest;
                getStoredSummary = dbServiceM.getStoredSummary;
                getStoredConversation = dbServiceM.getStoredConversation;
                storeSummary = dbServiceM.storeSummary;
                storeConversation = dbServiceM.storeConversation;
                showSummaryModal = modalManagerM.showSummaryModal;
                summarySystemPrompt = configM.summarySystemPrompt;
                qaSystemPrompt = configM.qaSystemPrompt;
            } catch (importErr) {
                console.error('[AI Modal] Failed to load modules:', importErr);
                alert('Failed to load necessary components for AI features.');
                if (floatBtnForState) floatBtnForState.dataset.summaryAvailable = 'false';
                throw importErr;
            }

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

            let storedSummary = await getStoredSummary(contentId, baseUrl);
            const summaryExisted = !!storedSummary?.summaryHtml;
            let summary = storedSummary?.summaryHtml;
            let userPrompt = storedSummary?.userPrompt || null;
            const bodyHtml = '';

            let conversation = null;
            if (!summary) {
                const { openaiApiKey, customApiEndpoint } = await new Promise(res => chrome.storage.sync.get(['openaiApiKey', 'customApiEndpoint'], res));
                if (!openaiApiKey) {
                    alert('An OpenAI API key is required to generate summaries.\n\nPlease configure it in the extension options.');
                    if (floatBtnForState) floatBtnForState.dataset.summaryAvailable = 'false';
                    return;
                }
                userPrompt = await getUserPrompt(pageData);
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
                await storeSummary({ contentId, baseUrl, title: pageData.title, summaryHtml: summary, bodyHtml, userPrompt });
                storedSummary = { summaryHtml: summary, userPrompt };
            }

            if (floatBtnForState) floatBtnForState.dataset.summaryAvailable = 'true';

            if (!userPrompt && storedSummary) { // Ensure userPrompt is loaded if summary came from cache
                userPrompt = storedSummary.userPrompt || await getUserPrompt(pageData);
            } else if (!userPrompt) { // Fallback if everything else failed (e.g. very old cache)
                userPrompt = await getUserPrompt(pageData);
            }


            if (!conversation) {
                const storedConv = await getStoredConversation(contentId, baseUrl);
                if (storedConv?.messages) {
                    conversation = storedConv.messages;
                } else {
                    conversation = [
                        { role: 'system', content: qaSystemPrompt },
                        { role: 'user', content: userPrompt },
                        { role: 'assistant', content: summary }
                    ];
                    await storeConversation(contentId, baseUrl, conversation);
                }
            }

            const { autoOpenSummary } = await new Promise(res => chrome.storage.sync.get(['autoOpenSummary'], res));
            if (autoOpenSummary === true || summaryExisted) {
                await showSummaryModal(summary, pageData, bodyHtml, baseUrl, userPrompt);
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
            if (floatBtnForState) floatBtnForState.dataset.summaryAvailable = 'false';
            const msg = err?.message || 'Failed to generate or load summary.';
            console.error('[AI Modal] Failed to summarize page:', msg);
            alert(msg);
            throw err; // Propagate to click handler's finally
        }

        const modalManagerM = await import(chrome.runtime.getURL('views/ui/modalManager.js'));
        modalManagerM.setupModalResizers();
    }

    async function extractContentIdFromUrl(pathname) {
        const pageIdMatch = window.location.search.match(/pageId=(\d+)/);
        if (pageIdMatch) return pageIdMatch[1];
        const meta = document.querySelector('meta[name="ajs-page-id"]');
        if (meta) return meta.getAttribute('content');
        if (window.AJS?.params?.pageId) return window.AJS.params.pageId;
        const pathMatch = pathname.match(/\/pages\/viewpage\.action\?pageId=(\d+)/);
        if (pathMatch) return pathMatch[1];
        const displayMatch = pathname.match(/^\/display\/([^/]+)\/(.+)$/);
        if (displayMatch) {
            const spaceKey = decodeURIComponent(displayMatch[1]);
            const title = decodeURIComponent(displayMatch[2].replace(/\+/g, ' '));
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
        return null;
    }

    async function checkStoredSummaryStatus(contentId, baseUrl, floatBtn, updateAppearanceFn) {
        if (!contentId || !floatBtn) return;
        try {
            const { getStoredSummary } = await import(chrome.runtime.getURL('views/services/dbService.js'));
            const stored = await getStoredSummary(contentId, baseUrl);
            if (stored?.summaryHtml) {
                floatBtn.dataset.summaryAvailable = 'true';
            } else {
                floatBtn.dataset.summaryAvailable = 'false';
            }
        } catch (err) {
            console.error('Failed to check stored summary:', err);
            floatBtn.dataset.summaryAvailable = 'false';
        } finally {
            if (typeof updateAppearanceFn === 'function') {
                updateAppearanceFn(floatBtn.matches(':hover'));
            }
        }
    }

    window.addEventListener('unhandledrejection', event => {
        console.error('[Unhandled Rejection]', event.reason);
    });
})();