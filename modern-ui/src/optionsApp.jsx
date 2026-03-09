import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

const DB_NAME = 'ConfluenceSummariesDB';
const DB_VERSION = 5;
const SUMMARY_STORE = 'summaries';
const CONVERSATION_STORE = 'conversations';

const DEFAULT_RESULTS_PER_REQUEST = 75;

const retiredModelFallbacks = {
  'gpt-4o': 'gpt-5.2-chat-latest',
  'gpt-4.1': 'gpt-5.2-chat-latest',
  'gpt-4.1-mini': 'gpt-5.2-chat-latest',
  o3: 'gpt-5.2-chat-latest',
  'o4-mini': 'gpt-5.2-chat-latest',
};

const modelOptions = [
  { value: 'gpt-5.2-chat-latest', label: 'gpt-5.2-chat-latest' },
  { value: 'gpt-5.2-pro', label: 'gpt-5.2-pro' },
  { value: 'gpt-5-pro', label: 'gpt-5-pro' },
  { value: 'gpt-5.2', label: 'gpt-5.2' },
  { value: 'gpt-5.1', label: 'gpt-5.1' },
  { value: 'gpt-5', label: 'gpt-5' },
  { value: 'gpt-5-chat-latest', label: 'gpt-5-chat-latest' },
  { value: 'gpt-5-mini', label: 'gpt-5-mini' },
  { value: 'gpt-5-nano', label: 'gpt-5-nano' },
];

const reasoningEffortOptions = [
  { value: '', label: 'Model default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const normalizeReasoningEffort = (value, legacyHigh = false) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') return normalized;
  return legacyHigh ? 'high' : '';
};

const hasRtl = (value) => /[\u0590-\u05FF\u0600-\u06FF]/.test(value || '');

const isValidDomain = (domain) => /^(?!:\/\/)([a-zA-Z0-9-_]+\.)*[a-zA-Z0-9][a-zA-Z0-9-_]+\.[a-zA-Z]{2,11}?$/.test(domain);
let domainRowSeed = 0;
const createDomainEntry = (entry = {}) => ({
  rowId: `domain-row-${Date.now()}-${domainRowSeed += 1}`,
  domain: entry.domain || '',
});

const getChrome = () => globalThis.chrome;

const getSync = (keys) => new Promise((resolve) => {
  const api = getChrome();
  if (!api?.storage?.sync?.get) {
    resolve({});
    return;
  }
  api.storage.sync.get(keys, resolve);
});

const setSync = (payload) => {
  const api = getChrome();
  if (!api?.storage?.sync?.set) return;
  api.storage.sync.set(payload);
};

const getLocal = (keys) => new Promise((resolve) => {
  const api = getChrome();
  if (!api?.storage?.local?.get) {
    resolve({});
    return;
  }
  api.storage.local.get(keys, resolve);
});

const setLocal = (payload) => {
  const api = getChrome();
  if (!api?.storage?.local?.set) return;
  api.storage.local.set(payload);
};

const requestOriginsPermission = async (origins) => new Promise((resolve) => {
  const api = getChrome();
  if (!api?.permissions?.request || !api?.permissions?.contains) {
    resolve({ granted: false, reason: 'permissions_api_unavailable' });
    return;
  }
  api.permissions.request({ origins }, (granted) => {
    if (!granted) {
      resolve({ granted: false, reason: 'user_denied' });
      return;
    }

    api.permissions.contains({ origins }, (hasPermission) => {
      resolve({
        granted: !!hasPermission,
        reason: hasPermission ? '' : 'not_granted_after_request',
      });
    });
  });
});

const openDb = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onerror = () => reject(req.error);
  req.onsuccess = () => resolve(req.result);
  req.onupgradeneeded = (event) => {
    const db = event.target.result;
    if (!db.objectStoreNames.contains(SUMMARY_STORE)) {
      db.createObjectStore(SUMMARY_STORE, { keyPath: ['contentId', 'baseUrl'] });
    }
    if (!db.objectStoreNames.contains(CONVERSATION_STORE)) {
      db.createObjectStore(CONVERSATION_STORE, { keyPath: ['contentId', 'baseUrl'] });
    }
  };
});

const clearStores = async (stores) => {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to clear stores'));
    stores.forEach((storeName) => {
      tx.objectStore(storeName).clear();
    });
  });
};

function ToggleRow({ label, desc, checked, onChange, id }) {
  return (
    <div class="setting-row">
      <div>
        <label class="setting-label" htmlFor={id}>{label}</label>
        <p class="setting-desc">{desc}</p>
      </div>
      <label class="switch" htmlFor={id}>
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
        <span class="switch-slider" />
      </label>
    </div>
  );
}

function DomainRow({ domain, onChangeDomain, onRemove }) {
  return (
    <div class="domain-row">
      <input
        value={domain}
        onInput={(e) => onChangeDomain(e.currentTarget.value)}
        placeholder="example.com"
        dir={hasRtl(domain) ? 'rtl' : 'ltr'}
      />
      <button class="domain-remove" onClick={onRemove} title="Remove domain">×</button>
    </div>
  );
}

export function OptionsApp() {
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [showTreeTooltips, setShowTreeTooltips] = useState(true);
  const [showTableTooltips, setShowTableTooltips] = useState(true);
  const [highlightResultRows, setHighlightResultRows] = useState(true);
  const [enableSummaries, setEnableSummaries] = useState(true);
  const [enableFloatingSummarize, setEnableFloatingSummarize] = useState(true);
  const [selectedAiModel, setSelectedAiModel] = useState('gpt-5.2-chat-latest');
  const [reasoningEffort, setReasoningEffort] = useState('');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [customApiEndpoint, setCustomApiEndpoint] = useState('');
  const [customUserPrompt, setCustomUserPrompt] = useState('');
  const [resultsPerRequest, setResultsPerRequest] = useState(DEFAULT_RESULTS_PER_REQUEST);

  const [domainSettings, setDomainSettings] = useState([createDomainEntry()]);
  const [domainDirty, setDomainDirty] = useState(false);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [status, setStatus] = useState({ type: '', msg: '' });
  const [confirmState, setConfirmState] = useState({
    open: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    danger: false,
    onConfirm: null,
  });

  const promptDebounceRef = useRef(null);
  const poofAudioRef = useRef(null);

  const statusClass = useMemo(() => {
    if (!status.type) return 'status';
    return `status ${status.type}`;
  }, [status.type]);

  const showStatus = (msg, type = 'success') => {
    setStatus({ msg, type });
  };

  const updateDomainAt = (index, patch) => {
    setDomainSettings((prev) => prev.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
    setDomainDirty(true);
  };

  const addDomain = () => {
    setDomainSettings((prev) => [...prev, createDomainEntry()]);
    setDomainDirty(true);
  };

  const removeDomain = (index) => {
    setDomainSettings((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length > 0 ? next : [createDomainEntry()];
    });
    setDomainDirty(true);
  };

  const saveDomains = async () => {
    const normalized = [];

    for (const entry of domainSettings) {
      const domain = (entry.domain || '').trim();

      if (!domain) continue;

      if (!isValidDomain(domain)) {
        showStatus('Invalid domain.', 'error');
        return;
      }

      normalized.push({ domain });
    }

    if (normalized.length === 0) {
      showStatus('Please add at least one valid domain setting.', 'error');
      return;
    }

    const isFirefox = typeof InstallTrigger !== 'undefined';
    if (!isFirefox) {
      const origins = [...new Set(normalized.map((item) => `*://${item.domain}/*`))];
      const permissionResult = await requestOriginsPermission(origins);
      if (!permissionResult.granted) {
        if (permissionResult.reason === 'permissions_api_unavailable') {
          showStatus('Permissions API is unavailable. Reload the extension and verify manifest permissions.', 'error');
          return;
        }
        showStatus('Permission denied for one or more domains.', 'error');
        return;
      }
    }

    setSync({ domainSettings: normalized });
    setDomainSettings(normalized.map((entry) => createDomainEntry(entry)));
    setDomainDirty(false);
    showStatus('Domain settings saved.', 'success');
  };

  const askConfirm = ({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm }) => {
    setConfirmState({
      open: true,
      title,
      message,
      confirmLabel,
      danger,
      onConfirm,
    });
  };

  const closeConfirm = () => {
    setConfirmState((prev) => ({ ...prev, open: false, onConfirm: null }));
  };

  const runConfirmedAction = async () => {
    const action = confirmState.onConfirm;
    closeConfirm();
    if (typeof action === 'function') await action();
  };

  const poof = () => {
    const player = poofAudioRef.current;
    if (!player) return;
    player.currentTime = 0;
    player.play().catch(() => {});
  };

  useEffect(() => {
    (async () => {
      const syncData = await getSync([
        'domainSettings',
        'darkMode',
        'showTooltips',
        'showTreeTooltips',
        'showTableTooltips',
        'highlightResultRows',
        'enableSummaries',
        'enableFloatingSummarize',
        'openaiApiKey',
        'customApiEndpoint',
        'resultsPerRequest',
        'selectedAiModel',
        'reasoningEffort',
        'useHighReasoningEffort',
      ]);
      const localData = await getLocal(['customUserPrompt']);
      const merged = { ...syncData, ...localData };

      setDarkMode(!!merged.darkMode);
      const legacyTooltip = merged.showTooltips;
      setShowTreeTooltips((merged.showTreeTooltips ?? legacyTooltip) !== false);
      setShowTableTooltips((merged.showTableTooltips ?? legacyTooltip) !== false);
      setHighlightResultRows(merged.highlightResultRows !== false);
      setEnableSummaries(merged.enableSummaries !== false);
      setEnableFloatingSummarize(merged.enableFloatingSummarize !== false);
      setOpenaiApiKey(merged.openaiApiKey || '');
      setCustomApiEndpoint(merged.customApiEndpoint || '');
      setCustomUserPrompt(merged.customUserPrompt || '');
      if (Number.isInteger(merged.resultsPerRequest)) {
        setResultsPerRequest(merged.resultsPerRequest);
      }
      setReasoningEffort(normalizeReasoningEffort(merged.reasoningEffort, merged.useHighReasoningEffort === true));

      const requestedModel = retiredModelFallbacks[merged.selectedAiModel] || merged.selectedAiModel || 'gpt-5.2-chat-latest';
      setSelectedAiModel(requestedModel);
      if (merged.selectedAiModel && requestedModel !== merged.selectedAiModel) {
        setSync({ selectedAiModel: requestedModel });
      }

      const domains = Array.isArray(merged.domainSettings) && merged.domainSettings.length > 0
        ? merged.domainSettings
        : [createDomainEntry()];
      setDomainSettings(domains.map((entry) => createDomainEntry(entry)));
      setDomainDirty(false);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    document.body.classList.toggle('dark-mode', darkMode);
  }, [darkMode]);

  useEffect(() => () => {
    if (promptDebounceRef.current) clearTimeout(promptDebounceRef.current);
  }, []);

  const onDarkModeChange = (next) => {
    setDarkMode(next);
    setSync({ darkMode: next });
  };

  const onTreeTooltipChange = (next) => {
    setShowTreeTooltips(next);
    setSync({ showTreeTooltips: next });
  };

  const onTableTooltipChange = (next) => {
    setShowTableTooltips(next);
    setSync({ showTableTooltips: next });
  };

  const onHighlightChange = (next) => {
    setHighlightResultRows(next);
    setSync({ highlightResultRows: next });
  };

  const onEnableSummariesChange = (next) => {
    setEnableSummaries(next);
    setSync({ enableSummaries: next });
  };

  const onEnableFloatingSummarizeChange = (next) => {
    setEnableFloatingSummarize(next);
    setSync({ enableFloatingSummarize: next });
  };

  const onModelChange = (next) => {
    setSelectedAiModel(next);
    setSync({ selectedAiModel: next });
  };

  const onReasoningEffortChange = (next) => {
    const normalized = normalizeReasoningEffort(next, false);
    setReasoningEffort(normalized);
    setSync({
      reasoningEffort: normalized,
      useHighReasoningEffort: normalized === 'high',
    });
  };

  const onApiKeyChange = (next) => {
    setOpenaiApiKey(next);
    setSync({ openaiApiKey: next.trim() });
  };

  const onCustomEndpointChange = (next) => {
    setCustomApiEndpoint(next);
    setSync({ customApiEndpoint: next.trim() });
  };

  const onCustomPromptChange = (next) => {
    setCustomUserPrompt(next);
    if (promptDebounceRef.current) clearTimeout(promptDebounceRef.current);
    promptDebounceRef.current = setTimeout(() => {
      setLocal({ customUserPrompt: next.trim() });
    }, 280);
  };

  const onResultsPerRequestChange = (next) => {
    const parsed = Number.parseInt(next, 10);
    if (!Number.isInteger(parsed)) return;
    setResultsPerRequest(parsed);
    setSync({ resultsPerRequest: parsed });
  };

  const clearAllSummariesAndConversations = async () => {
    try {
      poof();
      await clearStores([SUMMARY_STORE, CONVERSATION_STORE]);
      const api = getChrome();
      if (api?.runtime?.sendMessage) {
        api.runtime.sendMessage({ action: 'summariesCleared' });
      }
      showStatus('All summaries and follow-up conversations cleared.', 'success');
    } catch (err) {
      showStatus(`Failed to clear data: ${err?.message || 'Unknown error'}`, 'error');
    }
  };

  const clearOnlyConversations = async () => {
    try {
      poof();
      await clearStores([CONVERSATION_STORE]);
      showStatus('Follow-up conversations cleared.', 'success');
    } catch (err) {
      showStatus(`Failed to clear conversations: ${err?.message || 'Unknown error'}`, 'error');
    }
  };

  if (loading) {
    return (
      <div class="options-root loading-shell">
        <div class="loading-card">Loading options...</div>
      </div>
    );
  }

  return (
    <div class="options-root">
      <header class="options-hero panel">
        <img src="../../assets/logo.png" alt="Enhanced Search Results" class="options-logo" />
        <div>
          <h1>Extension Options</h1>
          <p>Configure appearance, AI behavior, and workspace-specific settings.</p>
        </div>
      </header>

      <main class="options-layout">
        <section class="panel">
          <div class="section-head">
            <h2>Domain Options</h2>
            <button class="btn secondary" onClick={addDomain}>+ Add Domain</button>
          </div>

          <div class="domain-grid">
            {domainSettings.map((entry, idx) => (
              <DomainRow
                key={entry.rowId}
                domain={entry.domain}
                onChangeDomain={(value) => updateDomainAt(idx, { domain: value })}
                onRemove={() => removeDomain(idx)}
              />
            ))}
          </div>

          <div class="section-actions">
            <button class="btn" disabled={!domainDirty} onClick={saveDomains}>Save Domain Settings</button>
          </div>
          <div class={statusClass}>{status.msg || ' '}</div>
        </section>

        <section class="panel">
          <h2>Appearance</h2>
          <div class="settings-list">
            <ToggleRow
              id="dark-mode"
              label="Dark Mode"
              desc="Use dark surfaces across the extension UI."
              checked={darkMode}
              onChange={onDarkModeChange}
            />
            <ToggleRow
              id="tree-tooltips"
              label="Show Tooltips in Tree View"
              desc="Display a modern hover card with type, contributor, space, and modified date."
              checked={showTreeTooltips}
              onChange={onTreeTooltipChange}
            />
            <ToggleRow
              id="table-tooltips"
              label="Show Tooltips in Table View"
              desc="Display rich hover cards for space and contributor in table rows."
              checked={showTableTooltips}
              onChange={onTableTooltipChange}
            />
            <ToggleRow
              id="highlight-results"
              label="Highlight Result Rows in Tree View"
              desc="Visually distinguish search hits from ancestor pages."
              checked={highlightResultRows}
              onChange={onHighlightChange}
            />
          </div>
        </section>

        <section class="panel">
          <h2>AI Options</h2>
          <div class="settings-list">
            <ToggleRow
              id="enable-summaries"
              label="Enable AI Summary in Enhanced Results Page"
              desc="Show the summarize/open button next to search results."
              checked={enableSummaries}
              onChange={onEnableSummariesChange}
            />
            <ToggleRow
              id="enable-floating"
              label="Enable AI Summary in Confluence Pages"
              desc="Show summarize actions directly on Confluence content pages."
              checked={enableFloatingSummarize}
              onChange={onEnableFloatingSummarizeChange}
            />

            <div class="setting-row stacked">
              <div>
                <label class="setting-label" htmlFor="ai-model">AI Model</label>
                <p class="setting-desc">Model used for summaries and follow-up Q&A.</p>
              </div>
              <select id="ai-model" value={selectedAiModel} onChange={(e) => onModelChange(e.currentTarget.value)}>
                {modelOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div class="setting-row stacked">
              <div>
                <label class="setting-label" htmlFor="reasoning-effort">Reasoning Effort</label>
                <p class="setting-desc">Choose how much deliberate reasoning to request for supported models.</p>
              </div>
              <select
                id="reasoning-effort"
                value={reasoningEffort}
                onChange={(e) => onReasoningEffortChange(e.currentTarget.value)}
              >
                {reasoningEffortOptions.map((option) => (
                  <option key={option.value || 'default'} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div class="setting-row stacked">
              <div>
                <label class="setting-label" htmlFor="api-key">OpenAI API Key</label>
                <p class="setting-desc">Stored locally in extension sync storage.</p>
              </div>
              <input
                id="api-key"
                type="password"
                value={openaiApiKey}
                onInput={(e) => onApiKeyChange(e.currentTarget.value)}
                placeholder="Paste your API key"
              />
            </div>

            <div class="setting-row stacked">
              <div>
                <label class="setting-label" htmlFor="custom-endpoint">Custom OpenAI API Base URL</label>
                <p class="setting-desc">Optional override (the extension appends /responses automatically).</p>
              </div>
              <input
                id="custom-endpoint"
                type="text"
                value={customApiEndpoint}
                onInput={(e) => onCustomEndpointChange(e.currentTarget.value)}
                placeholder="https://api.openai.com/v1"
              />
            </div>

            <div class="setting-row stacked">
              <div>
                <label class="setting-label" htmlFor="custom-prompt">Custom User Prompt</label>
                <p class="setting-desc">This prompt is appended to the default prompt for summary generation.</p>
              </div>
              <textarea
                id="custom-prompt"
                value={customUserPrompt}
                onInput={(e) => onCustomPromptChange(e.currentTarget.value)}
                dir={hasRtl(customUserPrompt) ? 'rtl' : 'ltr'}
                placeholder="Optional custom prompt"
              />
            </div>

            <div class="danger-block">
              <div>
                <div class="setting-label">Clear Cached AI-Generated Content</div>
                <p class="setting-desc">Remove local summaries and/or follow-up conversation history.</p>
              </div>
              <div class="danger-actions">
                <button
                  class="btn danger"
                  onClick={() => askConfirm({
                    title: 'Delete all summaries and conversations?',
                    message: 'This action cannot be undone.',
                    confirmLabel: 'Delete All',
                    danger: true,
                    onConfirm: clearAllSummariesAndConversations,
                  })}
                >
                  Summaries + Conversations
                </button>
                <button
                  class="btn danger ghost"
                  onClick={() => askConfirm({
                    title: 'Delete follow-up conversations?',
                    message: 'Summaries will be kept.',
                    confirmLabel: 'Delete Conversations',
                    danger: true,
                    onConfirm: clearOnlyConversations,
                  })}
                >
                  Conversations Only
                </button>
              </div>
            </div>
          </div>
        </section>

        <section class="panel">
          <button
            class="advanced-toggle"
            onClick={() => setAdvancedOpen((prev) => !prev)}
            title="Toggle advanced settings"
          >
            <span>Advanced Settings</span>
            <span>{advancedOpen ? '▾' : '▸'}</span>
          </button>

          {advancedOpen && (
            <div class="settings-list advanced-box">
              <div class="setting-row stacked">
                <div>
                  <label class="setting-label" htmlFor="results-per-request">Results per Batch</label>
                  <p class="setting-desc">How many results are fetched per request in the enhanced view.</p>
                </div>
                <select
                  id="results-per-request"
                  value={String(resultsPerRequest)}
                  onChange={(e) => onResultsPerRequestChange(e.currentTarget.value)}
                >
                  <option value="50">50</option>
                  <option value="75">75</option>
                  <option value="100">100</option>
                  <option value="125">125</option>
                  <option value="150">150</option>
                  <option value="200">200</option>
                </select>
              </div>
            </div>
          )}
        </section>
      </main>

      <audio ref={poofAudioRef} src="../../assets/sounds/swoosh.mp3" preload="auto" />

      {confirmState.open && (
        <div class="dialog-overlay" onClick={closeConfirm}>
          <div class="dialog-card" onClick={(e) => e.stopPropagation()}>
            <h3>{confirmState.title}</h3>
            <p>{confirmState.message}</p>
            <div class="dialog-actions">
              <button class="btn secondary" onClick={closeConfirm}>Cancel</button>
              <button class={`btn ${confirmState.danger ? 'danger' : ''}`} onClick={runConfirmedAction}>
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
