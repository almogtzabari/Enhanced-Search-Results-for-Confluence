import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  AI_MODEL_OPTIONS,
  CONVERSATION_STORE,
  DB_NAME,
  DB_VERSION,
  DEFAULT_AI_MODEL,
  retiredModelFallbacks,
  SUMMARY_STORE,
} from './shared/constants.js';
import { clearObjectStores } from './services/indexedDb.js';
import { requestOriginsPermission } from './services/permissions.js';
import { getChrome, getLocal, getSync, setLocal, setSync, subscribeStorageChanges } from './services/storage.js';
import { normalizeResponsesUrl } from './shared/openai.js';

const DEFAULT_RESULTS_PER_REQUEST = 75;
const STORAGE_WRITE_DEBOUNCE_MS = 320;
const FLOATING_PRIMARY_ACTION_DEFAULT = 'summarize';

const floatingPrimaryActionOptions = [
  { value: 'search', label: 'Search' },
  { value: 'summarize', label: 'Summarize and chat' },
];

const normalizeFloatingPrimaryAction = (value) => (
  value === 'search' || value === 'summarize'
    ? value
    : FLOATING_PRIMARY_ACTION_DEFAULT
);

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

function ensureSummaryStores(db) {
  if (!db.objectStoreNames.contains(SUMMARY_STORE)) {
    db.createObjectStore(SUMMARY_STORE, { keyPath: ['contentId', 'baseUrl'] });
  }
  if (!db.objectStoreNames.contains(CONVERSATION_STORE)) {
    db.createObjectStore(CONVERSATION_STORE, { keyPath: ['contentId', 'baseUrl'] });
  }
}

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
  const [syncThemeToConfluencePage, setSyncThemeToConfluencePage] = useState(false);
  const [showTreeTooltips, setShowTreeTooltips] = useState(true);
  const [showTableTooltips, setShowTableTooltips] = useState(true);
  const [highlightResultRows, setHighlightResultRows] = useState(true);
  const [enableSummaries, setEnableSummaries] = useState(true);
  const [enableFloatingSummarize, setEnableFloatingSummarize] = useState(true);
  const [floatingPrimaryAction, setFloatingPrimaryAction] = useState(FLOATING_PRIMARY_ACTION_DEFAULT);
  const [selectedAiModel, setSelectedAiModel] = useState(DEFAULT_AI_MODEL);
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
  const apiKeyDebounceRef = useRef(null);
  const endpointDebounceRef = useRef(null);
  const skipInitialApiKeySaveRef = useRef(true);
  const skipInitialEndpointSaveRef = useRef(true);
  const poofAudioRef = useRef(null);

  const statusClass = useMemo(() => {
    if (!status.type) return 'status';
    return `status ${status.type}`;
  }, [status.type]);

  const showStatus = (msg, type = 'success') => {
    setStatus({ msg, type });
  };

  const showStorageWriteError = (label, error) => {
    showStatus(`Failed to save ${label}: ${error || 'Unknown error'}`, 'error');
  };

  const persistSync = async (payload, label = 'settings') => {
    const result = await setSync(payload);
    if (!result.ok) {
      showStorageWriteError(label, result.error);
      return false;
    }
    return true;
  };

  const persistLocal = async (payload, label = 'settings') => {
    const result = await setLocal(payload);
    if (!result.ok) {
      showStorageWriteError(label, result.error);
      return false;
    }
    return true;
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

    const saved = await persistSync({ domainSettings: normalized }, 'domain settings');
    if (!saved) return;
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
    const unsubscribe = subscribeStorageChanges((changes, area) => {
      if (area !== 'sync') return;
      if (!changes.selectedAiModel) return;
      const requestedModel = retiredModelFallbacks[changes.selectedAiModel.newValue]
        || changes.selectedAiModel.newValue
        || DEFAULT_AI_MODEL;
      setSelectedAiModel(requestedModel);
      if (changes.selectedAiModel.newValue && requestedModel !== changes.selectedAiModel.newValue) {
        void persistSync({ selectedAiModel: requestedModel }, 'AI model');
      }
    });

    (async () => {
      const syncData = await getSync([
        'domainSettings',
        'darkMode',
        'syncThemeToConfluencePage',
        'showTooltips',
        'showTreeTooltips',
        'showTableTooltips',
        'highlightResultRows',
        'enableSummaries',
        'enableFloatingSummarize',
        'floatingPrimaryAction',
        'openaiApiKey',
        'customApiEndpoint',
        'resultsPerRequest',
        'selectedAiModel',
        'reasoningEffort',
        'useHighReasoningEffort',
      ]);
      const localData = await getLocal(['customUserPrompt', 'openaiApiKey']);
      const merged = { ...syncData, ...localData };
      const syncApiKey = typeof syncData.openaiApiKey === 'string' ? syncData.openaiApiKey.trim() : '';
      const localApiKey = typeof localData.openaiApiKey === 'string' ? localData.openaiApiKey.trim() : '';
      const effectiveApiKey = localApiKey || syncApiKey;

      setDarkMode(!!merged.darkMode);
      setSyncThemeToConfluencePage(merged.syncThemeToConfluencePage === true);
      const legacyTooltip = merged.showTooltips;
      setShowTreeTooltips((merged.showTreeTooltips ?? legacyTooltip) !== false);
      setShowTableTooltips((merged.showTableTooltips ?? legacyTooltip) !== false);
      setHighlightResultRows(merged.highlightResultRows !== false);
      setEnableSummaries(merged.enableSummaries !== false);
      setEnableFloatingSummarize(merged.enableFloatingSummarize !== false);
      setFloatingPrimaryAction(normalizeFloatingPrimaryAction(merged.floatingPrimaryAction));
      setOpenaiApiKey(effectiveApiKey);
      setCustomApiEndpoint(merged.customApiEndpoint || '');
      setCustomUserPrompt(merged.customUserPrompt || '');
      if (Number.isInteger(merged.resultsPerRequest)) {
        setResultsPerRequest(merged.resultsPerRequest);
      }
      setReasoningEffort(normalizeReasoningEffort(merged.reasoningEffort, merged.useHighReasoningEffort === true));

      const requestedModel = retiredModelFallbacks[merged.selectedAiModel] || merged.selectedAiModel || DEFAULT_AI_MODEL;
      setSelectedAiModel(requestedModel);
      if (merged.selectedAiModel && requestedModel !== merged.selectedAiModel) {
        void persistSync({ selectedAiModel: requestedModel }, 'AI model');
      }

      const domains = Array.isArray(merged.domainSettings) && merged.domainSettings.length > 0
        ? merged.domainSettings
        : [createDomainEntry()];
      setDomainSettings(domains.map((entry) => createDomainEntry(entry)));
      setDomainDirty(false);

      if (!localApiKey && syncApiKey) {
        const writeLocalResult = await setLocal({ openaiApiKey: syncApiKey });
        if (writeLocalResult.ok) {
          await setSync({ openaiApiKey: '' });
        }
      }

      setLoading(false);
    })();

    return unsubscribe;
  }, []);

  useEffect(() => {
    document.body.classList.toggle('dark-mode', darkMode);
  }, [darkMode]);

  useEffect(() => () => {
    if (promptDebounceRef.current) clearTimeout(promptDebounceRef.current);
    if (apiKeyDebounceRef.current) clearTimeout(apiKeyDebounceRef.current);
    if (endpointDebounceRef.current) clearTimeout(endpointDebounceRef.current);
  }, []);

  const onDarkModeChange = (next) => {
    setDarkMode(next);
    void persistSync({ darkMode: next }, 'dark mode');
  };

  const onSyncThemeToConfluencePageChange = (next) => {
    setSyncThemeToConfluencePage(next);
    void persistSync({ syncThemeToConfluencePage: next }, 'Confluence modal theme sync');
  };

  const onTreeTooltipChange = (next) => {
    setShowTreeTooltips(next);
    void persistSync({ showTreeTooltips: next }, 'tree tooltip preference');
  };

  const onTableTooltipChange = (next) => {
    setShowTableTooltips(next);
    void persistSync({ showTableTooltips: next }, 'table tooltip preference');
  };

  const onHighlightChange = (next) => {
    setHighlightResultRows(next);
    void persistSync({ highlightResultRows: next }, 'row highlight preference');
  };

  const onEnableSummariesChange = (next) => {
    setEnableSummaries(next);
    void persistSync({ enableSummaries: next }, 'AI summary toggle');
  };

  const onEnableFloatingSummarizeChange = (next) => {
    setEnableFloatingSummarize(next);
    void persistSync({ enableFloatingSummarize: next }, 'floating summary toggle');
  };

  const onFloatingPrimaryActionChange = (next) => {
    const normalized = normalizeFloatingPrimaryAction(next);
    setFloatingPrimaryAction(normalized);
    void persistSync({ floatingPrimaryAction: normalized }, 'floating primary action');
  };

  const onModelChange = (next) => {
    setSelectedAiModel(next);
    void persistSync({ selectedAiModel: next }, 'AI model');
  };

  const onReasoningEffortChange = (next) => {
    const normalized = normalizeReasoningEffort(next, false);
    setReasoningEffort(normalized);
    void persistSync({
      reasoningEffort: normalized,
      useHighReasoningEffort: normalized === 'high',
    }, 'reasoning effort');
  };

  const onApiKeyChange = (next) => {
    setOpenaiApiKey(next);
  };

  const onCustomEndpointChange = (next) => {
    setCustomApiEndpoint(next);
  };

  const onGrantEndpointPermission = async () => {
    const configuredBase = (customApiEndpoint || '').trim() || 'https://api.openai.com/v1';
    let origin = '';
    try {
      origin = new URL(normalizeResponsesUrl(configuredBase)).origin;
    } catch {
      showStatus('Invalid OpenAI endpoint URL.', 'error');
      return;
    }

    const permissionResult = await requestOriginsPermission([`${origin}/*`]);
    if (!permissionResult.granted) {
      if (permissionResult.reason === 'request_failed' || permissionResult.reason === 'contains_failed') {
        showStatus('Could not request endpoint permission. Try again from this Options page.', 'error');
        return;
      }
      showStatus('Permission denied for the OpenAI endpoint domain.', 'error');
      return;
    }

    showStatus(`Endpoint permission granted for ${origin}.`, 'success');
  };

  const onCustomPromptChange = (next) => {
    setCustomUserPrompt(next);
    if (promptDebounceRef.current) clearTimeout(promptDebounceRef.current);
    promptDebounceRef.current = setTimeout(() => {
      void persistLocal({ customUserPrompt: next.trim() }, 'custom user prompt');
    }, STORAGE_WRITE_DEBOUNCE_MS);
  };

  const onResultsPerRequestChange = (next) => {
    const parsed = Number.parseInt(next, 10);
    if (!Number.isInteger(parsed)) return;
    setResultsPerRequest(parsed);
    void persistSync({ resultsPerRequest: parsed }, 'results per batch');
  };

  useEffect(() => {
    if (loading) return undefined;
    if (skipInitialApiKeySaveRef.current) {
      skipInitialApiKeySaveRef.current = false;
      return undefined;
    }

    if (apiKeyDebounceRef.current) clearTimeout(apiKeyDebounceRef.current);
    apiKeyDebounceRef.current = setTimeout(() => {
      void persistLocal({ openaiApiKey: openaiApiKey.trim() }, 'OpenAI API key');
    }, STORAGE_WRITE_DEBOUNCE_MS);

    return () => {
      if (apiKeyDebounceRef.current) clearTimeout(apiKeyDebounceRef.current);
    };
  }, [openaiApiKey, loading]);

  useEffect(() => {
    if (loading) return undefined;
    if (skipInitialEndpointSaveRef.current) {
      skipInitialEndpointSaveRef.current = false;
      return undefined;
    }

    if (endpointDebounceRef.current) clearTimeout(endpointDebounceRef.current);
    endpointDebounceRef.current = setTimeout(() => {
      void persistSync({ customApiEndpoint: customApiEndpoint.trim() }, 'custom API endpoint');
    }, STORAGE_WRITE_DEBOUNCE_MS);

    return () => {
      if (endpointDebounceRef.current) clearTimeout(endpointDebounceRef.current);
    };
  }, [customApiEndpoint, loading]);

  const clearAllSummariesAndConversations = async () => {
    try {
      poof();
      await clearObjectStores({
        dbName: DB_NAME,
        dbVersion: DB_VERSION,
        onUpgradeNeeded: ensureSummaryStores,
        stores: [SUMMARY_STORE, CONVERSATION_STORE],
      });
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
      await clearObjectStores({
        dbName: DB_NAME,
        dbVersion: DB_VERSION,
        onUpgradeNeeded: ensureSummaryStores,
        stores: [CONVERSATION_STORE],
      });
      showStatus('Follow-up conversations cleared.', 'success');
    } catch (err) {
      showStatus(`Failed to clear conversations: ${err?.message || 'Unknown error'}`, 'error');
    }
  };

  if (loading) {
    return (
      <div class="options-root" aria-busy="true" />
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
              id="sync-theme-confluence"
              label="Sync theme selection in Confluence page"
              desc="When enabled, dark mode is also applied to the AI modal opened inside Confluence pages."
              checked={syncThemeToConfluencePage}
              onChange={onSyncThemeToConfluencePageChange}
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
                <label class="setting-label" htmlFor="floating-primary-action">Floating Primary Button</label>
                <p class="setting-desc">Pick which action appears as the default floating button. Hover still reveals Search, Summarize and chat, and Settings.</p>
              </div>
              <select
                id="floating-primary-action"
                value={floatingPrimaryAction}
                onChange={(e) => onFloatingPrimaryActionChange(e.currentTarget.value)}
                disabled={!enableFloatingSummarize}
              >
                {floatingPrimaryActionOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div class="setting-row stacked">
              <div>
                <label class="setting-label" htmlFor="ai-model">AI Model</label>
                <p class="setting-desc">Model used for summaries and follow-up Q&A.</p>
              </div>
              <select id="ai-model" value={selectedAiModel} onChange={(e) => onModelChange(e.currentTarget.value)}>
                {AI_MODEL_OPTIONS.map((option) => (
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
                <p class="setting-desc">Stored locally in extension local storage (not synced).</p>
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
                <p class="setting-desc">Optional override (the extension appends /responses automatically). Click Grant Endpoint Permission after changes.</p>
              </div>
              <div class="inline-control-stack">
                <input
                  id="custom-endpoint"
                  type="text"
                  value={customApiEndpoint}
                  onInput={(e) => onCustomEndpointChange(e.currentTarget.value)}
                  placeholder="https://api.openai.com/v1"
                />
                <div class="section-actions tight">
                  <button class="btn secondary" type="button" onClick={onGrantEndpointPermission}>
                    Grant Endpoint Permission
                  </button>
                </div>
              </div>
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
