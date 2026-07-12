import { useEffect, useRef, useState } from 'preact/hooks';
import {
  AI_MODEL_OPTIONS,
  CONVERSATION_STORE,
  DB_NAME,
  DB_VERSION,
  DEFAULT_AI_MODEL,
  retiredModelFallbacks,
  SUMMARY_STORE,
} from './shared/constants.js';
import { CustomSelect } from './components/CustomSelect.jsx';
import { clearObjectStores } from './services/indexedDb.js';
import { requestOriginsPermission } from './services/permissions.js';
import { getChrome, getLocal, getSync, setLocal, setSync, subscribeStorageChanges } from './services/storage.js';
import { normalizeResponsesUrl } from './shared/openai.js';

const DEFAULT_RESULTS_PER_REQUEST = 75;
const STORAGE_WRITE_DEBOUNCE_MS = 320;
const STATUS_FADE_START_MS = 9400;
const STATUS_AUTO_DISMISS_MS = 10000;
const AI_OPTIONS_ANIMATION_MS = 220;
const FLOATING_PRIMARY_ACTION_DEFAULT = 'search';
const DEFAULT_OPENAI_API_BASE_URL = 'https://api.openai.com/v1';

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

const resultsPerRequestOptions = [
  { value: '50', label: '50' },
  { value: '75', label: '75' },
  { value: '100', label: '100' },
  { value: '125', label: '125' },
  { value: '150', label: '150' },
  { value: '200', label: '200' },
];

const normalizeReasoningEffort = (value, legacyHigh = false) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') return normalized;
  return legacyHigh ? 'high' : '';
};

const hasRtl = (value) => /[\u0590-\u05FF\u0600-\u06FF]/.test(value || '');

const isValidDomain = (domain) => /^(?!:\/\/)([a-zA-Z0-9-_]+\.)*[a-zA-Z0-9][a-zA-Z0-9-_]+\.[a-zA-Z]{2,11}?$/.test(domain);
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const normalizeDomainInput = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const hasScheme = HAS_SCHEME.test(raw);
  const candidate = hasScheme ? raw : `https://${raw}`;

  try {
    const parsed = new URL(candidate);
    if (hasScheme && !/^https?:$/.test(parsed.protocol)) return '';
    return String(parsed.hostname || '').trim().toLowerCase().replace(/\.+$/, '');
  } catch {
    return '';
  }
};

const normalizeDomainListForCompare = (entries) => {
  if (!Array.isArray(entries)) return [];
  const tokens = entries
    .map((entry) => {
      const raw = String(entry?.domain || '').trim();
      if (!raw) return '';
      const normalized = normalizeDomainInput(raw);
      return normalized || `invalid:${raw.toLowerCase()}`;
    })
    .filter(Boolean);
  return [...new Set(tokens)].sort();
};

const normalizeDomainListForSave = (entries) => {
  if (!Array.isArray(entries)) return { normalized: [], invalid: false };
  const normalized = [];
  for (const entry of entries) {
    const raw = String(entry?.domain || '').trim();
    if (!raw) continue;
    const domain = normalizeDomainInput(raw);
    if (!domain || !isValidDomain(domain)) {
      return { normalized: [], invalid: true };
    }
    normalized.push({ domain });
  }
  return {
    normalized: [...new Map(normalized.map((item) => [item.domain, item])).values()],
    invalid: false,
  };
};

const areArraysEqual = (left, right) => {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
};

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

function DomainRow({
  domain,
  onChangeDomain,
  onRemove,
}) {
  return (
    <div class="domain-row">
      <input
        value={domain}
        onInput={(e) => onChangeDomain(e.currentTarget.value)}
        placeholder="example.com"
        dir={hasRtl(domain) ? 'rtl' : 'ltr'}
      />
      <button type="button" class="domain-remove" onClick={onRemove} title="Remove domain">×</button>
    </div>
  );
}

export function OptionsApp() {
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [syncThemeToConfluencePage, setSyncThemeToConfluencePage] = useState(true);
  const [showTreeTooltips, setShowTreeTooltips] = useState(true);
  const [showTableTooltips, setShowTableTooltips] = useState(true);
  const [highlightResultRows, setHighlightResultRows] = useState(true);
  const [enableAiFeatures, setEnableAiFeatures] = useState(false);
  const [floatingPrimaryAction, setFloatingPrimaryAction] = useState(FLOATING_PRIMARY_ACTION_DEFAULT);
  const [selectedAiModel, setSelectedAiModel] = useState(DEFAULT_AI_MODEL);
  const [reasoningEffort, setReasoningEffort] = useState('');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [customApiEndpoint, setCustomApiEndpoint] = useState('');
  const [customUserPrompt, setCustomUserPrompt] = useState('');
  const [resultsPerRequest, setResultsPerRequest] = useState(DEFAULT_RESULTS_PER_REQUEST);

  const [domainSettings, setDomainSettings] = useState([createDomainEntry()]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [hasPendingSettingsChanges, setHasPendingSettingsChanges] = useState(false);
  const [saveBaseline, setSaveBaseline] = useState({ domains: [], endpoint: '' });
  const [defaultEndpointWarningShown, setDefaultEndpointWarningShown] = useState(false);
  const [attentionState, setAttentionState] = useState({
    domain: false,
    endpoint: false,
    apiKey: false,
  });

  const [testingApiKey, setTestingApiKey] = useState(false);
  const [apiKeyTestResult, setApiKeyTestResult] = useState('');
  const [statusNotices, setStatusNotices] = useState([]);
  const [aiOptionsVisibilityState, setAiOptionsVisibilityState] = useState('closed');
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
  const statusNoticeIdRef = useRef(0);
  const statusNoticeTimersRef = useRef(new Map());
  const skipInitialApiKeySaveRef = useRef(true);
  const poofAudioRef = useRef(null);
  const aiOptionsCloseTimerRef = useRef(null);
  const aiOptionsOpenFrameRef = useRef(null);

  const markSettingsChanged = () => {
    setHasPendingSettingsChanges(true);
  };

  const dismissStatus = (id) => {
    setStatusNotices((prev) => prev.filter((item) => item.id !== id));
    const timers = statusNoticeTimersRef.current.get(id);
    if (timers) {
      clearTimeout(timers.fadeTimer);
      clearTimeout(timers.removeTimer);
      statusNoticeTimersRef.current.delete(id);
    }
  };

  const clearStatusNotices = (resetState = true) => {
    statusNoticeTimersRef.current.forEach((timers) => {
      clearTimeout(timers.fadeTimer);
      clearTimeout(timers.removeTimer);
    });
    statusNoticeTimersRef.current.clear();
    if (resetState) {
      setStatusNotices([]);
    }
  };

  const showStatus = (msg, type = 'success') => {
    if (!msg) return;
    const id = statusNoticeIdRef.current + 1;
    statusNoticeIdRef.current = id;

    setStatusNotices((prev) => {
      const next = [...prev, {
        id,
        type,
        msg,
        closing: false,
      }];
      return next.slice(-5);
    });

    const fadeTimer = setTimeout(() => {
      setStatusNotices((prev) => prev.map((item) => (item.id === id ? { ...item, closing: true } : item)));
    }, STATUS_FADE_START_MS);
    const removeTimer = setTimeout(() => {
      dismissStatus(id);
    }, STATUS_AUTO_DISMISS_MS);
    statusNoticeTimersRef.current.set(id, { fadeTimer, removeTimer });
  };

  const showStatuses = (items = []) => {
    items.forEach(({ msg, type }) => showStatus(msg, type));
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
    markSettingsChanged();
    setDomainSettings((prev) => prev.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
    setAttentionState((prev) => ({ ...prev, domain: false }));
  };

  const addDomain = () => {
    markSettingsChanged();
    setDomainSettings((prev) => [...prev, createDomainEntry()]);
    setAttentionState((prev) => ({ ...prev, domain: false }));
  };

  const removeDomain = (index) => {
    markSettingsChanged();
    setDomainSettings((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length > 0 ? next : [createDomainEntry()];
    });
    setAttentionState((prev) => ({ ...prev, domain: false }));
  };

  const saveSettings = async () => {
    if (savingSettings) return;
    clearStatusNotices();
    setSavingSettings(true);

    try {
      const domainResult = normalizeDomainListForSave(domainSettings);
      const normalizedDomains = [...domainResult.normalized];

      if (domainResult.invalid) {
        setAttentionState((prev) => ({ ...prev, domain: true }));
        showStatus('Invalid domain. Enter hostnames like confluence.example.com.', 'error');
        return;
      }

      if (normalizedDomains.length === 0) {
        setAttentionState((prev) => ({ ...prev, domain: true }));
        showStatus('Add at least one Confluence domain before saving. Example: confluence.example.com.', 'error');
        return;
      }

      const endpointValue = String(customApiEndpoint || '').trim();
      const usingDefaultEndpoint = !endpointValue;
      let endpointOrigin = '';
      try {
        endpointOrigin = new URL(normalizeResponsesUrl(endpointValue || DEFAULT_OPENAI_API_BASE_URL)).origin;
      } catch {
        setAttentionState((prev) => ({ ...prev, endpoint: true }));
        showStatus('Invalid custom OpenAI API Base URL. Enter a valid URL or leave it blank to use the default.', 'error');
        return;
      }

      const origins = [...new Set([
        ...normalizedDomains.map((item) => `*://${item.domain}/*`),
        `${endpointOrigin}/*`,
      ])];
      const permissionResult = await requestOriginsPermission(origins);
      if (!permissionResult.granted) {
        setAttentionState((prev) => ({ ...prev, domain: true, endpoint: true }));
        if (permissionResult.reason === 'permissions_api_unavailable') {
          showStatus('Permissions API is unavailable. Reload the extension and verify manifest permissions.', 'error');
          return;
        }
        if (permissionResult.reason === 'request_failed' || permissionResult.reason === 'contains_failed') {
          showStatus('Could not request required permissions. Keep this Options page open and try Save Settings again.', 'error');
          return;
        }
        showStatus('Permissions were not granted. Domain and OpenAI endpoint permissions are required.', 'error');
        return;
      }

      const saved = await persistSync({
        domainSettings: normalizedDomains,
        customApiEndpoint: endpointValue,
      }, 'settings');
      if (!saved) return;

      const missingApiKey = enableAiFeatures && !String(openaiApiKey || '').trim();
      const postSaveNotices = [];
      const shouldWarnDefaultEndpoint = enableAiFeatures && usingDefaultEndpoint && !defaultEndpointWarningShown;
      if (shouldWarnDefaultEndpoint) {
        postSaveNotices.push({
          type: 'warning',
          msg: 'No custom OpenAI API Base URL is set, so the default OpenAI base URL (https://api.openai.com/v1) will be used.',
        });
      }
      if (missingApiKey) {
        postSaveNotices.push({
          type: 'error',
          msg: 'OpenAI API Key is empty, so AI summaries and follow-up Q&A will remain unavailable.',
        });
      }

      setAttentionState({
        domain: false,
        endpoint: false,
        apiKey: missingApiKey,
      });
      setDomainSettings(normalizedDomains.map((entry) => createDomainEntry(entry)));
      setCustomApiEndpoint(endpointValue);
      setSaveBaseline({
        domains: normalizedDomains.map((item) => item.domain).sort(),
        endpoint: endpointValue,
      });
      setHasPendingSettingsChanges(false);

      if (postSaveNotices.length > 0) {
        if (shouldWarnDefaultEndpoint) {
          setDefaultEndpointWarningShown(true);
          void persistLocal({ defaultEndpointWarningShown: true }, 'default endpoint warning state');
        }
        showStatuses(postSaveNotices);
        return;
      }

      showStatus('Settings saved', 'success');
    } finally {
      setSavingSettings(false);
    }
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
      if (changes.darkMode) {
        setDarkMode(!!changes.darkMode.newValue);
      }
      if (changes.syncThemeToConfluencePage) {
        setSyncThemeToConfluencePage(changes.syncThemeToConfluencePage.newValue !== false);
      }
      if (changes.selectedAiModel) {
        const requestedModel = retiredModelFallbacks[changes.selectedAiModel.newValue]
          || changes.selectedAiModel.newValue
          || DEFAULT_AI_MODEL;
        setSelectedAiModel(requestedModel);
        if (changes.selectedAiModel.newValue && requestedModel !== changes.selectedAiModel.newValue) {
          void persistSync({ selectedAiModel: requestedModel }, 'AI model');
        }
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
        'enableAiFeatures',
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
      const localData = await getLocal(['customUserPrompt', 'openaiApiKey', 'defaultEndpointWarningShown']);
      const merged = { ...syncData, ...localData };
      const syncApiKey = typeof syncData.openaiApiKey === 'string' ? syncData.openaiApiKey.trim() : '';
      const localApiKey = typeof localData.openaiApiKey === 'string' ? localData.openaiApiKey.trim() : '';
      const effectiveApiKey = localApiKey || syncApiKey;

      setDarkMode(!!merged.darkMode);
      setSyncThemeToConfluencePage(merged.syncThemeToConfluencePage !== false);
      const legacyTooltip = merged.showTooltips;
      setShowTreeTooltips((merged.showTreeTooltips ?? legacyTooltip) !== false);
      setShowTableTooltips((merged.showTableTooltips ?? legacyTooltip) !== false);
      setHighlightResultRows(merged.highlightResultRows !== false);
      const hasAiFeaturesFlag = typeof merged.enableAiFeatures === 'boolean';
      const hasSummariesFlag = typeof merged.enableSummaries === 'boolean';
      const hasFloatingFlag = typeof merged.enableFloatingSummarize === 'boolean';
      const mergedSummariesEnabled = merged.enableSummaries !== false;
      const mergedFloatingEnabled = merged.enableFloatingSummarize !== false;
      const aiEnabled = hasAiFeaturesFlag
        ? merged.enableAiFeatures
        : (hasSummariesFlag || hasFloatingFlag ? (mergedSummariesEnabled || mergedFloatingEnabled) : false);
      setEnableAiFeatures(aiEnabled);
      if (aiEnabled && (!mergedSummariesEnabled || !mergedFloatingEnabled)) {
        void persistSync({
          enableSummaries: true,
          enableFloatingSummarize: true,
        }, 'AI summary availability');
      }
      const preferredPrimaryAction = aiEnabled
        ? normalizeFloatingPrimaryAction(merged.floatingPrimaryAction)
        : 'search';
      setFloatingPrimaryAction(preferredPrimaryAction);
      if (!aiEnabled && merged.floatingPrimaryAction !== 'search') {
        void persistSync({ floatingPrimaryAction: 'search' }, 'floating primary action');
      }
      setOpenaiApiKey(effectiveApiKey);
      setCustomApiEndpoint(merged.customApiEndpoint || '');
      setCustomUserPrompt(merged.customUserPrompt || '');
      setDefaultEndpointWarningShown(localData.defaultEndpointWarningShown === true);
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
      const normalizedDomainEntries = domains.map((entry) => createDomainEntry({
        ...entry,
        domain: normalizeDomainInput(entry?.domain) || String(entry?.domain || '').trim(),
      }));
      setDomainSettings(normalizedDomainEntries);
      setSaveBaseline({
        domains: normalizeDomainListForSave(normalizedDomainEntries).normalized.map((item) => item.domain).sort(),
        endpoint: String(merged.customApiEndpoint || '').trim(),
      });

      if (!localApiKey && syncApiKey) {
        const writeLocalResult = await setLocal({ openaiApiKey: syncApiKey });
        if (writeLocalResult.ok) {
          await setSync({ openaiApiKey: '' });
        }
      }

      setHasPendingSettingsChanges(false);
      setLoading(false);
    })();

    return unsubscribe;
  }, []);

  useEffect(() => {
    document.body.classList.toggle('dark-mode', darkMode);
  }, [darkMode]);

  useEffect(() => {
    if (aiOptionsOpenFrameRef.current) {
      cancelAnimationFrame(aiOptionsOpenFrameRef.current);
      aiOptionsOpenFrameRef.current = null;
    }
    if (aiOptionsCloseTimerRef.current) {
      clearTimeout(aiOptionsCloseTimerRef.current);
      aiOptionsCloseTimerRef.current = null;
    }

    if (enableAiFeatures) {
      if (aiOptionsVisibilityState === 'open') return undefined;
      setAiOptionsVisibilityState('opening');
      aiOptionsOpenFrameRef.current = window.requestAnimationFrame(() => {
        setAiOptionsVisibilityState('open');
        aiOptionsOpenFrameRef.current = null;
      });
      return () => {
        if (aiOptionsOpenFrameRef.current) {
          cancelAnimationFrame(aiOptionsOpenFrameRef.current);
          aiOptionsOpenFrameRef.current = null;
        }
      };
    }

    if (aiOptionsVisibilityState === 'closed') return undefined;
    setAiOptionsVisibilityState('closing');
    aiOptionsCloseTimerRef.current = setTimeout(() => {
      setAiOptionsVisibilityState('closed');
      aiOptionsCloseTimerRef.current = null;
    }, AI_OPTIONS_ANIMATION_MS);
    return () => {
      if (aiOptionsCloseTimerRef.current) {
        clearTimeout(aiOptionsCloseTimerRef.current);
        aiOptionsCloseTimerRef.current = null;
      }
    };
  }, [enableAiFeatures, aiOptionsVisibilityState]);

  useEffect(() => () => {
    if (promptDebounceRef.current) clearTimeout(promptDebounceRef.current);
    if (apiKeyDebounceRef.current) clearTimeout(apiKeyDebounceRef.current);
    if (aiOptionsOpenFrameRef.current) cancelAnimationFrame(aiOptionsOpenFrameRef.current);
    if (aiOptionsCloseTimerRef.current) clearTimeout(aiOptionsCloseTimerRef.current);
    clearStatusNotices(false);
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event) => {
      if (!hasPendingSettingsChanges) return;
      event.preventDefault();
      event.returnValue = 'Unsaved changes detected. Are you sure you want to leave this page?';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasPendingSettingsChanges]);

  const onDarkModeChange = (next) => {
    setDarkMode(next);
    void persistSync({ darkMode: next }, 'dark mode');
  };

  const onSyncThemeToConfluencePageChange = (next) => {
    markSettingsChanged();
    setSyncThemeToConfluencePage(next);
    void persistSync({ syncThemeToConfluencePage: next }, 'Confluence theme matching');
  };

  const onTreeTooltipChange = (next) => {
    markSettingsChanged();
    setShowTreeTooltips(next);
    void persistSync({ showTreeTooltips: next }, 'tree tooltip preference');
  };

  const onTableTooltipChange = (next) => {
    markSettingsChanged();
    setShowTableTooltips(next);
    void persistSync({ showTableTooltips: next }, 'table tooltip preference');
  };

  const onHighlightChange = (next) => {
    markSettingsChanged();
    setHighlightResultRows(next);
    void persistSync({ highlightResultRows: next }, 'row highlight preference');
  };

  const onEnableAiFeaturesChange = (next) => {
    markSettingsChanged();
    setEnableAiFeatures(next);
    if (!next) {
      setFloatingPrimaryAction('search');
      void persistSync({
        enableAiFeatures: false,
        enableSummaries: false,
        enableFloatingSummarize: true,
        floatingPrimaryAction: 'search',
      }, 'AI features');
      return;
    }

    void persistSync({
      enableAiFeatures: true,
      enableSummaries: true,
      enableFloatingSummarize: true,
    }, 'AI features');
  };

  const onFloatingPrimaryActionChange = (next) => {
    markSettingsChanged();
    const normalized = normalizeFloatingPrimaryAction(next);
    setFloatingPrimaryAction(normalized);
    void persistSync({ floatingPrimaryAction: normalized }, 'floating primary action');
  };

  const onModelChange = (next) => {
    markSettingsChanged();
    setSelectedAiModel(next);
    void persistSync({ selectedAiModel: next }, 'AI model');
  };

  const onReasoningEffortChange = (next) => {
    markSettingsChanged();
    const normalized = normalizeReasoningEffort(next, false);
    setReasoningEffort(normalized);
    void persistSync({
      reasoningEffort: normalized,
      useHighReasoningEffort: normalized === 'high',
    }, 'reasoning effort');
  };

  const onApiKeyChange = (next) => {
    markSettingsChanged();
    setOpenaiApiKey(next);
    setApiKeyTestResult('');
    setAttentionState((prev) => ({ ...prev, apiKey: false }));
  };

  const onCustomEndpointChange = (next) => {
    markSettingsChanged();
    setCustomApiEndpoint(next);
    setApiKeyTestResult('');
    setAttentionState((prev) => ({ ...prev, endpoint: false }));
  };

  const onTestApiKey = async () => {
    if (testingApiKey) return;

    const apiKey = String(openaiApiKey || '').trim();
    if (!apiKey) {
      setApiKeyTestResult('error');
      setAttentionState((prev) => ({ ...prev, apiKey: true }));
      showStatus('OpenAI API Key is empty. Add your key before running a test.', 'error');
      return;
    }

    const baseApiUrl = String(customApiEndpoint || '').trim() || DEFAULT_OPENAI_API_BASE_URL;
    try {
      // Validate early to avoid unnecessary runtime messaging for malformed URLs.
      // normalizeResponsesUrl appends /responses as needed.
      // eslint-disable-next-line no-new
      new URL(normalizeResponsesUrl(baseApiUrl));
    } catch {
      setApiKeyTestResult('error');
      setAttentionState((prev) => ({ ...prev, endpoint: true }));
      showStatus('Invalid custom OpenAI API Base URL. Fix it before testing the API key.', 'error');
      return;
    }

    const api = getChrome();
    if (!api?.runtime?.sendMessage) {
      setApiKeyTestResult('error');
      showStatus('Runtime messaging API is unavailable. Reload the extension and try again.', 'error');
      return;
    }

    setApiKeyTestResult('');
    setTestingApiKey(true);

    try {
      const result = await new Promise((resolve) => {
        api.runtime.sendMessage(
          {
            action: 'validateOpenAiApiKey',
            apiKey,
            apiUrl: baseApiUrl,
          },
          (response) => {
            const runtimeError = api.runtime?.lastError?.message || '';
            if (runtimeError) {
              resolve({ ok: false, valid: false, error: runtimeError });
              return;
            }
            resolve({
              ok: response?.ok !== false,
              valid: response?.valid === true,
              error: response?.error || '',
            });
          },
        );
      });

      if (!result.ok) {
        setApiKeyTestResult('error');
        showStatus(`API key test failed: ${result.error || 'Unknown error'}`, 'error');
        return;
      }

      if (result.valid) {
        setApiKeyTestResult('success');
        showStatus('OpenAI API key is valid for the currently configured endpoint.', 'success');
        return;
      }

      setApiKeyTestResult('error');
      showStatus(`OpenAI API key appears invalid: ${result.error || 'Authentication failed.'}`, 'error');
    } finally {
      setTestingApiKey(false);
    }
  };

  const onCustomPromptChange = (next) => {
    markSettingsChanged();
    setCustomUserPrompt(next);
    if (promptDebounceRef.current) clearTimeout(promptDebounceRef.current);
    promptDebounceRef.current = setTimeout(() => {
      void persistLocal({ customUserPrompt: next.trim() }, 'custom user prompt');
    }, STORAGE_WRITE_DEBOUNCE_MS);
  };

  const onResultsPerRequestChange = (next) => {
    const parsed = Number.parseInt(next, 10);
    if (!Number.isInteger(parsed)) return;
    markSettingsChanged();
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

  const domainCompareTokens = normalizeDomainListForCompare(domainSettings);
  const hasUnsavedDomainChanges = !areArraysEqual(domainCompareTokens, saveBaseline.domains);
  const hasUnsavedEndpointChanges = String(customApiEndpoint || '').trim() !== saveBaseline.endpoint;
  const requiresInitialDomain = normalizeDomainListForSave(domainSettings).normalized.length === 0;
  const saveButtonNeedsAttention = hasPendingSettingsChanges || hasUnsavedDomainChanges || hasUnsavedEndpointChanges || requiresInitialDomain;
  const saveButtonClass = `btn floating-save-btn ${saveButtonNeedsAttention ? 'attention' : ''}`.trim();
  const apiKeyTestButtonClass = [
    'btn',
    'secondary',
    'inline-action-btn',
    apiKeyTestResult ? `inline-action-btn--${apiKeyTestResult}` : '',
    (!testingApiKey && apiKeyTestResult) ? 'inline-action-btn--symbol' : '',
  ].filter(Boolean).join(' ');
  const apiKeyTestButtonText = testingApiKey
    ? 'Testing...'
    : (apiKeyTestResult === 'success' ? '✓' : (apiKeyTestResult === 'error' ? '✕' : 'Test'));
  const apiKeyTestButtonTitle = testingApiKey
    ? 'Testing current API key against current endpoint'
    : (apiKeyTestResult === 'success'
      ? 'API key is valid for the current endpoint'
      : (apiKeyTestResult === 'error'
        ? 'API key validation failed for the current key/endpoint'
        : 'Test current API key with current endpoint'));
  const extensionVersion = getChrome()?.runtime?.getManifest?.()?.version || 'unknown';
  const aiOptionsMounted = aiOptionsVisibilityState !== 'closed';
  const aiOptionsExpanded = aiOptionsVisibilityState === 'open';
  const aiOptionsClassName = [
    'ai-options-collapse',
    aiOptionsExpanded ? 'is-expanded' : '',
    aiOptionsVisibilityState === 'closing' ? 'is-closing' : '',
  ].filter(Boolean).join(' ');

  return (
    <div class="options-root">
      <header class="options-hero panel">
        <img src="../../assets/logo.png" alt="Enhanced Search Results" class="options-logo" />
        <div class="options-hero-copy">
          <h1>Extension Options</h1>
          <p>Configure appearance, AI behavior, and workspace-specific settings.</p>
        </div>
        <div class="options-hero-actions">
          <button
            id="theme-toggle-btn"
            class="icon-btn topbar-icon-btn"
            type="button"
            onClick={() => onDarkModeChange(!darkMode)}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {darkMode ? (
              <span class="theme-moon-emoji" aria-hidden="true">🌙</span>
            ) : (
              <svg class="theme-icon-svg sun" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="4.8" fill="#f59e0b" />
                <g stroke="#fbbf24" stroke-width="1.7" stroke-linecap="round">
                  <path d="M12 2.4v2.2M12 19.4v2.2M4.6 12H2.4M21.6 12h-2.2M5.9 5.9l1.6 1.6M18.1 18.1l-1.6-1.6M18.1 5.9l-1.6 1.6M5.9 18.1l1.6-1.6" />
                </g>
              </svg>
            )}
          </button>
        </div>
      </header>
      {statusNotices.length > 0 && (
        <div class="status-stack" aria-live="polite">
          {statusNotices.map((notice) => (
            <div
              key={notice.id}
              class={`status status-floating ${notice.type || ''} ${notice.closing ? 'closing' : ''}`.trim()}
              role="status"
            >
              {notice.msg}
            </div>
          ))}
        </div>
      )}

      <main class="options-layout">
        <section class="panel quickstart-panel">
          <h2>{`Quick Setup Guide (v${extensionVersion})`}</h2>
          <p class="quickstart-intro">Follow these steps to set up the extension for your Confluence pages.</p>
          <div class="quickstart-group">
            <h3 class="quickstart-group-title">Basic Setup (Required)</h3>
            <ul class="quickstart-list">
              <li>Add at least one Confluence domain under <span class="quickstart-option-tag">Domain Options</span> (for example, <code>confluence.example.com</code>).</li>
              <li>Click <span class="quickstart-option-tag">Save Settings</span>. The browser will request the domain permissions required for content injection.</li>
            </ul>
          </div>
          <div class="quickstart-group">
            <h3 class="quickstart-group-title">AI Options (Optional)</h3>
            <ul class="quickstart-list">
              <li>Enable <span class="quickstart-option-tag">AI Options</span> and add your <span class="quickstart-option-tag">OpenAI API Key</span> to enable summaries and follow-up Q&amp;A.</li>
              <li><span class="quickstart-option-tag">Custom OpenAI API Base URL</span> is optional. If left empty, the default OpenAI endpoint will be used.</li>
              <li>When you click <span class="quickstart-option-tag">Save Settings</span>, the browser will request endpoint permissions required for API calls.</li>
              <li>You can set <span class="quickstart-option-tag">Floating Primary Button</span> to either Search or Summarize &amp; Chat.</li>
            </ul>
          </div>
        </section>

        <section class={`panel ${attentionState.domain ? 'needs-attention' : ''}`.trim()}>
          <div class="section-head">
            <h2>
              Domain Options
              <span class="meta-chip required">Required</span>
            </h2>
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
        </section>

        <section class="panel">
          <div class="section-head">
            <h2>
              AI Options
              <span class="meta-chip recommended">Recommended</span>
            </h2>
            <label class="switch section-head-toggle" htmlFor="enable-ai-features">
              <input
                id="enable-ai-features"
                type="checkbox"
                checked={enableAiFeatures}
                onChange={(e) => onEnableAiFeaturesChange(e.currentTarget.checked)}
              />
              <span class="switch-slider" />
            </label>
          </div>
          <p class="section-subtitle">Turn on AI summaries and follow-up Q&amp;A in views and Confluence pages.</p>
          <div class="settings-list">
            {aiOptionsMounted && (
              <div class={aiOptionsClassName} aria-hidden={!enableAiFeatures}>
                <div class="ai-options-inner">
                <div class="setting-row stacked">
                  <div>
                    <label class="setting-label" htmlFor="floating-primary-action">
                      Floating Primary Button
                      <span class="meta-chip recommended">Recommended</span>
                    </label>
                    <p class="setting-desc">Pick which action appears as the default floating button. Hover still reveals Search, Summarize and chat, and Settings.</p>
                  </div>
                  <CustomSelect
                    id="floating-primary-action"
                    value={floatingPrimaryAction}
                    options={floatingPrimaryActionOptions}
                    onChange={onFloatingPrimaryActionChange}
                    ariaLabel="Floating primary button"
                    className="options-model-select"
                    triggerClassName="options-model-select-trigger"
                    panelClassName="options-model-select-panel"
                    optionClassName="options-model-select-option"
                  />
                </div>

                <div class={`setting-row stacked ${attentionState.apiKey ? 'needs-attention' : ''}`.trim()}>
                  <div>
                    <label class="setting-label" htmlFor="api-key">
                      OpenAI API Key
                      <span class="meta-chip required">Required</span>
                    </label>
                    <p class="setting-desc">Stored locally in extension local storage (not synced). If this is blank, AI functionality will not be available.</p>
                  </div>
                  <div class="field-with-action-stack">
                    <div class="field-with-action">
                      <input
                        id="api-key"
                        type="password"
                        value={openaiApiKey}
                        onInput={(e) => onApiKeyChange(e.currentTarget.value)}
                        placeholder="Paste your API key"
                      />
                      <button
                        type="button"
                        class={apiKeyTestButtonClass}
                        onClick={onTestApiKey}
                        disabled={testingApiKey}
                        title={apiKeyTestButtonTitle}
                        aria-label={apiKeyTestButtonTitle}
                      >
                        {apiKeyTestButtonText}
                      </button>
                    </div>
                    <p class="field-hint">Test checks the current API key against the current endpoint URL.</p>
                  </div>
                </div>

                <div class={`setting-row stacked ${attentionState.endpoint ? 'needs-attention' : ''}`.trim()}>
                  <div>
                    <label class="setting-label" htmlFor="custom-endpoint">
                      Custom OpenAI API Base URL
                      <span class="meta-chip optional">Optional</span>
                      {attentionState.endpoint && <span class="attention-chip">Needs attention</span>}
                    </label>
                    <p class="setting-desc">Optional override (the extension appends /responses automatically). Leave blank to use OpenAI default. Save Settings to apply permission changes.</p>
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
                    <label class="setting-label" htmlFor="ai-model">AI Model</label>
                    <p class="setting-desc">Model used for summaries and follow-up Q&A.</p>
                  </div>
                  <CustomSelect
                    id="ai-model"
                    ariaLabel="AI model"
                    value={selectedAiModel}
                    options={AI_MODEL_OPTIONS}
                    onChange={onModelChange}
                    className="options-model-select"
                    triggerClassName="options-model-select-trigger"
                    panelClassName="options-model-select-panel"
                    optionClassName="options-model-select-option"
                  />
                </div>

                <div class="setting-row stacked">
                  <div>
                    <label class="setting-label" htmlFor="reasoning-effort">Reasoning Effort</label>
                    <p class="setting-desc">Choose how much deliberate reasoning to request for supported models.</p>
                  </div>
                  <CustomSelect
                    id="reasoning-effort"
                    value={reasoningEffort}
                    options={reasoningEffortOptions}
                    onChange={onReasoningEffortChange}
                    ariaLabel="Reasoning effort"
                    className="options-model-select"
                    triggerClassName="options-model-select-trigger"
                    panelClassName="options-model-select-panel"
                    optionClassName="options-model-select-option"
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
              </div>
            )}
          </div>
        </section>

        <section class="panel">
          <h2>Additional Options</h2>
          <div class="settings-list">
            <div class="setting-row stacked">
              <div>
                <label class="setting-label" htmlFor="results-per-request">Results per Batch</label>
                <p class="setting-desc">How many results are fetched per request in the enhanced view.</p>
              </div>
              <CustomSelect
                id="results-per-request"
                value={String(resultsPerRequest)}
                options={resultsPerRequestOptions}
                onChange={onResultsPerRequestChange}
                ariaLabel="Results per batch"
                className="options-model-select"
                triggerClassName="options-model-select-trigger"
                panelClassName="options-model-select-panel"
                optionClassName="options-model-select-option"
              />
            </div>

            <ToggleRow
              id="sync-theme-confluence"
              label="Match Confluence theme in page modal"
              desc="Use Confluence's light or dark theme for the summary and chat modal. When disabled, use the extension theme."
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
      </main>

      <audio ref={poofAudioRef} src="../../assets/sounds/swoosh.mp3" preload="auto" />
      <button
        type="button"
        class={saveButtonClass}
        onClick={saveSettings}
        disabled={savingSettings}
      >
        {savingSettings ? 'Saving...' : 'Save Settings'}
      </button>

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
