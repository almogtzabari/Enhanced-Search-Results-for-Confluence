import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  clearAllSavedSearches,
  deleteSavedSearch,
  getAllSavedSearches,
  storeSavedSearch,
} from '../../../services/dbClient.js';
import { fallbackSpaceIcon, fallbackUserIcon } from '../constants.js';
import { resolveConfluenceIconUrl } from '../utils/urlUtils.js';

// Owns saved-search CRUD, modal state, and save-name dialog orchestration.
export function useSavedSearchesController({
  baseUrl,
  searchText,
  filterText,
  filterSpace,
  spaceInput,
  filterContributor,
  contributorInput,
  filterDate,
  filterType,
  spaceOptions,
  contributorOptions,
  openNoticeDialog,
  openConfirmDialog,
  onRunSavedSearch,
}) {
  const [savedSearches, setSavedSearches] = useState([]);
  const [savedSearchVisualsById, setSavedSearchVisualsById] = useState({});
  const [savedSearchQuery, setSavedSearchQuery] = useState('');
  const [savedModalOpen, setSavedModalOpen] = useState(false);
  const [saveNameDialog, setSaveNameDialog] = useState({
    open: false,
    title: '',
    confirmLabel: 'Save',
    value: '',
    placeholder: 'Enter a name',
  });

  const saveNameDialogResolverRef = useRef(null);
  const saveNameDialogInputRef = useRef(null);

  const ensureUniqueName = (candidate, list, currentId = null) => {
    const normalized = candidate.trim();
    const base = normalized || 'Saved Search';
    const existing = new Set(list.filter((entry) => entry.id !== currentId).map((entry) => entry.name));
    if (!existing.has(base)) return base;
    let i = 1;
    let next = `${base} (${i})`;
    while (existing.has(next)) {
      i += 1;
      next = `${base} (${i})`;
    }
    return next;
  };

  const buildDefaultSavedName = () => {
    const date = new Date();
    return ensureUniqueName(
      `Search on ${date.toLocaleDateString()} at ${date.toLocaleTimeString()}`,
      savedSearches,
    );
  };

  const loadSavedSearches = async () => {
    try {
      const list = await getAllSavedSearches();
      setSavedSearches(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('[V2 Preact] Failed to load saved searches:', err);
      openNoticeDialog({
        title: 'Failed to Load Saved Searches',
        message: err.message || 'Unknown error',
        tone: 'error',
      });
    }
  };

  useEffect(() => {
    loadSavedSearches();
  }, []);

  useEffect(() => {
    if (!savedModalOpen) return;
    const pending = savedSearches.filter((entry) => !savedSearchVisualsById[entry.id]);
    if (pending.length === 0) return;

    let alive = true;
    (async () => {
      const updates = await Promise.all(
        pending.map(async (entry) => {
          const base = (entry.baseUrl || baseUrl || '').replace(/\/+$/, '');
          const spaceKey = entry.filters?.space?.key || '';
          const spaceLabel = entry.filters?.space?.label || '';
          const contributorKey = entry.filters?.contributor?.key || '';
          const contributorLabel = entry.filters?.contributor?.label || '';
          let spaceIconUrl = fallbackSpaceIcon;
          let contributorIconUrl = fallbackUserIcon;

          if (base && spaceKey) {
            try {
              const sRes = await fetch(
                `${base}/rest/api/space/${encodeURIComponent(spaceKey)}?expand=icon`,
                { credentials: 'include' },
              );
              if (sRes.ok) {
                const sData = await sRes.json();
                spaceIconUrl = resolveConfluenceIconUrl(base, sData?.icon?.path, fallbackSpaceIcon);
              }
            } catch {
              // non-fatal, fallback icon is used
            }
          }

          if (spaceIconUrl === fallbackSpaceIcon && base && spaceLabel) {
            try {
              const escaped = spaceLabel.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
              const cql = `type=space AND title ~ "${escaped}*"`;
              const searchRes = await fetch(
                `${base}/rest/api/search?cql=${encodeURIComponent(cql)}&limit=1&expand=space.icon`,
                { credentials: 'include' },
              );
              if (searchRes.ok) {
                const searchData = await searchRes.json();
                const iconPath = searchData?.results?.[0]?.space?.icon?.path || '';
                spaceIconUrl = resolveConfluenceIconUrl(base, iconPath, fallbackSpaceIcon);
              }
            } catch {
              // non-fatal, fallback icon is used
            }
          }

          if (base && contributorKey) {
            const tryUrls = [
              `${base}/rest/api/user?accountId=${encodeURIComponent(contributorKey)}`,
              `${base}/rest/api/user?username=${encodeURIComponent(contributorKey)}`,
              `${base}/rest/api/user?key=${encodeURIComponent(contributorKey)}`,
            ];

            for (let idx = 0; idx < tryUrls.length; idx += 1) {
              try {
                const uRes = await fetch(tryUrls[idx], { credentials: 'include' });
                if (!uRes.ok) continue;
                const uData = await uRes.json();
                const path = uData?.profilePicture?.path || '';
                contributorIconUrl = resolveConfluenceIconUrl(base, path, fallbackUserIcon);
                if (path) break;
              } catch {
                // try next url
              }
            }
          }

          if (contributorIconUrl === fallbackUserIcon && base && contributorLabel) {
            try {
              const listRes = await fetch(
                `${base}/rest/api/user/search?username=${encodeURIComponent(contributorLabel)}&limit=1`,
                { credentials: 'include' },
              );
              if (listRes.ok) {
                const list = await listRes.json();
                const path = Array.isArray(list) ? list[0]?.profilePicture?.path : '';
                contributorIconUrl = resolveConfluenceIconUrl(base, path, fallbackUserIcon);
              }
            } catch {
              // non-fatal, fallback icon is used
            }
          }

          return { id: entry.id, spaceIconUrl, contributorIconUrl };
        }),
      );

      if (!alive) return;
      setSavedSearchVisualsById((prev) => {
        const next = { ...prev };
        updates.forEach((item) => {
          next[item.id] = {
            spaceIconUrl: item.spaceIconUrl,
            contributorIconUrl: item.contributorIconUrl,
          };
        });
        return next;
      });
    })();

    return () => {
      alive = false;
    };
  }, [savedModalOpen, savedSearches, savedSearchVisualsById, baseUrl]);

  useEffect(() => {
    if (!savedModalOpen) return undefined;
    const onEscape = (e) => {
      if (e.key === 'Escape') setSavedModalOpen(false);
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [savedModalOpen]);

  useEffect(() => {
    if (!saveNameDialog.open) return undefined;
    const onEscape = (e) => {
      if (e.key === 'Escape') closeSaveNameDialog(null);
    };
    document.addEventListener('keydown', onEscape);
    const handle = setTimeout(() => saveNameDialogInputRef.current?.focus(), 0);
    return () => {
      clearTimeout(handle);
      document.removeEventListener('keydown', onEscape);
    };
  }, [saveNameDialog.open]);

  useEffect(() => () => {
    if (saveNameDialogResolverRef.current) {
      saveNameDialogResolverRef.current(null);
      saveNameDialogResolverRef.current = null;
    }
  }, []);

  const openSavedSearches = async () => {
    await loadSavedSearches();
    setSavedSearchQuery('');
    setSavedModalOpen(true);
  };

  const openSaveNameDialog = ({
    title,
    initialValue = '',
    confirmLabel = 'Save',
    placeholder = 'Enter a name',
  }) => new Promise((resolve) => {
    saveNameDialogResolverRef.current = resolve;
    setSaveNameDialog({
      open: true,
      title,
      value: initialValue,
      confirmLabel,
      placeholder,
    });
  });

  const closeSaveNameDialog = (value = null) => {
    const resolver = saveNameDialogResolverRef.current;
    saveNameDialogResolverRef.current = null;
    setSaveNameDialog((prev) => ({ ...prev, open: false, value: '' }));
    if (typeof resolver === 'function') resolver(value);
  };

  const handleSaveNameDialogSubmit = () => {
    closeSaveNameDialog(saveNameDialog.value);
  };

  const saveCurrentSearch = async () => {
    if (!searchText.trim()) {
      openNoticeDialog({
        title: 'Nothing to Save',
        message: 'Run a search before saving.',
        tone: 'info',
      });
      return;
    }

    const suggested = buildDefaultSavedName();
    const entered = await openSaveNameDialog({
      title: 'Name this search',
      initialValue: suggested,
      confirmLabel: 'Save',
      placeholder: 'Search name',
    });
    if (entered === null) return;

    const labelBySpaceKey = new Map(spaceOptions.map((x) => [x.key, x.name]));
    const labelByContributorKey = new Map(contributorOptions.map((x) => [x.key, x.name]));
    const finalName = ensureUniqueName(entered.trim() || suggested, savedSearches);

    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      name: finalName,
      searchText: searchText.trim(),
      baseUrl: baseUrl.trim(),
      filters: {
        text: { key: filterText.trim(), label: filterText.trim() },
        space: {
          key: filterSpace,
          label: filterSpace ? (spaceInput.trim() || labelBySpaceKey.get(filterSpace) || filterSpace) : '',
        },
        contributor: {
          key: filterContributor,
          label: filterContributor ? (contributorInput.trim() || labelByContributorKey.get(filterContributor) || filterContributor) : '',
        },
        date: filterDate,
        type: filterType,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      await storeSavedSearch(entry);
      await loadSavedSearches();
      openNoticeDialog({
        title: 'Saved',
        message: 'Search saved.',
        tone: 'success',
      });
    } catch (err) {
      console.error('[V2 Preact] Failed to save search:', err);
      openNoticeDialog({
        title: 'Failed to Save Search',
        message: err.message || 'Unknown error',
        tone: 'error',
      });
    }
  };

  const runSavedSearch = (entry) => {
    const applied = onRunSavedSearch(entry);
    if (applied) setSavedModalOpen(false);
  };

  const renameSavedSearch = async (entry) => {
    const entered = await openSaveNameDialog({
      title: 'Rename saved search',
      initialValue: entry.name || '',
      confirmLabel: 'Rename',
      placeholder: 'Saved search name',
    });
    if (entered === null) return;
    const trimmed = entered.trim();
    if (!trimmed) {
      openNoticeDialog({
        title: 'Invalid Name',
        message: 'Name cannot be empty.',
        tone: 'info',
      });
      return;
    }

    const renamed = {
      ...entry,
      name: ensureUniqueName(trimmed, savedSearches, entry.id),
      updatedAt: Date.now(),
    };
    try {
      await storeSavedSearch(renamed);
      setSavedSearches((prev) => prev.map((it) => (it.id === entry.id ? renamed : it)));
    } catch (err) {
      console.error('[V2 Preact] Failed to rename saved search:', err);
      openNoticeDialog({
        title: 'Failed to Rename Saved Search',
        message: err.message || 'Unknown error',
        tone: 'error',
      });
    }
  };

  const removeSavedSearch = async (entry) => {
    const confirmed = await openConfirmDialog({
      title: 'Delete saved search?',
      message: `Delete "${entry.name}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteSavedSearch(entry.id);
      setSavedSearches((prev) => prev.filter((it) => it.id !== entry.id));
    } catch (err) {
      console.error('[V2 Preact] Failed to delete saved search:', err);
      openNoticeDialog({
        title: 'Failed to Delete Saved Search',
        message: err.message || 'Unknown error',
        tone: 'error',
      });
    }
  };

  const removeAllSavedSearches = async () => {
    const confirmed = await openConfirmDialog({
      title: 'Clear all saved searches?',
      message: 'This will permanently remove all saved searches.',
      confirmLabel: 'Clear All',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await clearAllSavedSearches();
      setSavedSearches([]);
    } catch (err) {
      console.error('[V2 Preact] Failed to clear saved searches:', err);
      openNoticeDialog({
        title: 'Failed to Clear Saved Searches',
        message: err.message || 'Unknown error',
        tone: 'error',
      });
    }
  };

  const savedSearchesFiltered = useMemo(() => {
    const q = savedSearchQuery.toLowerCase().trim();
    const sorted = [...savedSearches].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!q) return sorted;
    return sorted.filter((entry) => {
      const text = (entry.filters?.text?.label || entry.filters?.text?.key || '').toLowerCase();
      const space = (entry.filters?.space?.label || entry.filters?.space?.key || '').toLowerCase();
      const contributor = (entry.filters?.contributor?.label || entry.filters?.contributor?.key || '').toLowerCase();
      const type = (entry.filters?.type || '').toLowerCase();
      const date = (entry.filters?.date || '').toLowerCase();
      const search = (entry.searchText || '').toLowerCase();
      const name = (entry.name || '').toLowerCase();
      return name.includes(q) || search.includes(q) || text.includes(q) || space.includes(q) || contributor.includes(q) || type.includes(q) || date.includes(q);
    });
  }, [savedSearches, savedSearchQuery]);

  return {
    state: {
      savedModalOpen,
      savedSearchQuery,
      savedSearchesFiltered,
      savedSearchVisualsById,
      saveNameDialog,
    },
    refs: {
      saveNameDialogInputRef,
    },
    actions: {
      setSavedModalOpen,
      setSavedSearchQuery,
      setSaveNameDialog,
      openSavedSearches,
      saveCurrentSearch,
      runSavedSearch,
      renameSavedSearch,
      removeSavedSearch,
      removeAllSavedSearches,
      closeSaveNameDialog,
      handleSaveNameDialogSubmit,
    },
  };
}
