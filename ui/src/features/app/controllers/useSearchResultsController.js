import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  DEFAULT_TABLE_COL_WIDTHS,
  MIN_TABLE_COL_WIDTH,
  TABLE_SORTABLE_COLUMNS,
  fallbackSpaceIcon,
  fallbackUserIcon,
} from '../constants.js';
import { formatDate } from '../utils/textUtils.js';
import {
  buildConfluenceUrl,
  resolveConfluenceIconUrl,
  updateUrlParams,
} from '../utils/urlUtils.js';
import {
  buildSearchSignature,
  cqlFromState,
  dedupeByKey,
  searchSpacesByQuery,
  searchUsersByQuery,
} from '../utils/searchUtils.js';
import { buildTree, collectExpandableNodeIds } from '../utils/treeUtils.js';
import { getTableSortValue } from '../utils/tableUtils.js';
import { loadStoredTableColWidths } from '../utils/uiStorage.js';

// Owns search/filter/view state, pagination lifecycle, and tree/table interactions.
export function useSearchResultsController({
  params,
  resultsPerRequest,
  enableSummaries,
  openNoticeDialog,
}) {
  const shouldFocusSearchFromQuery = String(params.focusSearch || '') === '1';
  const initialBase = (params.baseUrl || window.location.origin).trim();
  const initialText = (params.searchText || '').trim();
  const [initialSpaceKey, initialSpaceLabel] = (params.space || '').split(':');
  const [initialContributorKey, initialContributorLabel] = (params.contributor || '').split(':');

  const [baseUrl, setBaseUrl] = useState(initialBase);
  const [searchInput, setSearchInput] = useState(initialText);
  const [searchText, setSearchText] = useState(initialText);
  const [searchInputAttention, setSearchInputAttention] = useState(false);
  const [domainName, setDomainName] = useState('Unknown');

  const [view, setView] = useState('tree');
  const [loading, setLoading] = useState(false);
  const [initialSearchPending, setInitialSearchPending] = useState(!!initialText);
  const [allLoaded, setAllLoaded] = useState(false);
  const [start, setStart] = useState(0);
  const [totalSize, setTotalSize] = useState(null);
  const [allResults, setAllResults] = useState([]);
  const [lastFetchAt, setLastFetchAt] = useState(null);

  const [filterText, setFilterText] = useState((params.text || '').trim());
  const [filterSpace, setFilterSpace] = useState(initialSpaceKey || '');
  const [spaceInput, setSpaceInput] = useState(initialSpaceLabel || initialSpaceKey || '');
  const [selectedSpaceIcon, setSelectedSpaceIcon] = useState('');
  const [spaceSuggestions, setSpaceSuggestions] = useState([]);
  const [spaceDropdownOpen, setSpaceDropdownOpen] = useState(false);
  const [spaceActiveIndex, setSpaceActiveIndex] = useState(-1);
  const [spaceLookupLoading, setSpaceLookupLoading] = useState(false);
  const [filterContributor, setFilterContributor] = useState(initialContributorKey || '');
  const [contributorInput, setContributorInput] = useState(initialContributorLabel || initialContributorKey || '');
  const [selectedContributorIcon, setSelectedContributorIcon] = useState('');
  const [contributorSuggestions, setContributorSuggestions] = useState([]);
  const [contributorDropdownOpen, setContributorDropdownOpen] = useState(false);
  const [contributorActiveIndex, setContributorActiveIndex] = useState(-1);
  const [contributorLookupLoading, setContributorLookupLoading] = useState(false);
  const [filterDate, setFilterDate] = useState(params.date || 'any');
  const [filterType, setFilterType] = useState(params.type || '');

  const [collapsedNodes, setCollapsedNodes] = useState(() => new Set());
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [treeTooltipData, setTreeTooltipData] = useState(null);
  const [tableColWidths, setTableColWidths] = useState(() => loadStoredTableColWidths());
  const [tableSort, setTableSort] = useState({ key: '', direction: 'asc' });

  const scrollerRef = useRef(null);
  const inflightRef = useRef(false);
  const fetchMoreRef = useRef(null);
  const treeTooltipRef = useRef(null);
  const treeTooltipPointerRef = useRef({ x: 0, y: 0 });
  const spaceReqIdRef = useRef(0);
  const contributorReqIdRef = useRef(0);
  const spaceBoxRef = useRef(null);
  const contributorBoxRef = useRef(null);
  const searchInputRef = useRef(null);
  const didAutoFocusSearchRef = useRef(false);
  const searchFetchRequestIdRef = useRef(0);
  const searchFetchAbortRef = useRef(null);
  const activeSearchSignatureRef = useRef('');

  const activeSearchSignature = useMemo(() => buildSearchSignature({
    baseUrl,
    searchText,
    filterType,
    filterDate,
    filterSpace,
    filterContributor,
    resultsPerRequest,
  }), [baseUrl, searchText, filterType, filterDate, filterSpace, filterContributor, resultsPerRequest]);

  const resetLoadedData = () => {
    setAllResults([]);
    setCollapsedNodes(new Set());
    setAllLoaded(false);
    setStart(0);
    setTotalSize(null);
  };

  useEffect(() => {
    try {
      const host = new URL(baseUrl).hostname;
      setDomainName(host);
      document.title = searchText
        ? `Search: ${searchText} on ${host}`
        : `Enhanced Search on ${host}`;
    } catch {
      setDomainName('Unknown');
    }
  }, [baseUrl, searchText]);

  useEffect(() => {
    activeSearchSignatureRef.current = activeSearchSignature;
  }, [activeSearchSignature]);

  useEffect(() => {
    setAllResults([]);
    setCollapsedNodes(new Set());
    setAllLoaded(false);
    setStart(0);
    setTotalSize(null);
    setLastFetchAt(null);
    setInitialSearchPending(!!searchText);
    if (searchFetchAbortRef.current) {
      searchFetchAbortRef.current.abort();
      searchFetchAbortRef.current = null;
    }
    searchFetchRequestIdRef.current += 1;
    inflightRef.current = false;
    setLoading(false);
  }, [activeSearchSignature]);

  useEffect(() => () => {
    if (searchFetchAbortRef.current) {
      searchFetchAbortRef.current.abort();
      searchFetchAbortRef.current = null;
    }
  }, []);

  const filteredResults = useMemo(() => {
    const text = filterText.trim().toLowerCase();

    return allResults.filter((item) => {
      const title = (item.title || '').toLowerCase();
      const matchesText = !text || title.includes(text);
      const matchesSpace = !filterSpace || item.space?.key === filterSpace;
      const contributorKey = item.history?.createdBy?.username || item.history?.createdBy?.userKey || item.history?.createdBy?.accountId || '';
      const matchesContributor = !filterContributor || contributorKey === filterContributor;
      return matchesText && matchesSpace && matchesContributor;
    });
  }, [allResults, filterText, filterSpace, filterContributor]);

  const spaceOptions = useMemo(() => {
    const map = new Map();
    allResults.forEach((item) => {
      if (!item.space?.key || !item.space?.name) return;
      const iconPath = item.space?.icon?.path || '';
      const iconUrl = resolveConfluenceIconUrl(
        baseUrl,
        iconPath || '/images/logo/default-space-logo.svg',
        fallbackSpaceIcon,
      );
      map.set(item.space.key, { key: item.space.key, name: item.space.name, iconUrl });
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allResults, baseUrl]);

  const contributorOptions = useMemo(() => {
    const map = new Map();
    allResults.forEach((item) => {
      const c = item.history?.createdBy;
      const key = c?.username || c?.userKey || c?.accountId;
      if (!key) return;
      const avatarPath = c?.profilePicture?.path || '';
      const avatarUrl = resolveConfluenceIconUrl(
        baseUrl,
        avatarPath || '/images/icons/profilepics/default.png',
        fallbackUserIcon,
      );
      map.set(key, { key, name: c?.displayName || key, avatarUrl });
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allResults, baseUrl]);

  useEffect(() => {
    if (!filterSpace) {
      setSelectedSpaceIcon('');
      return;
    }
    const localMatch = spaceOptions.find((space) => space.key === filterSpace);
    if (localMatch?.iconUrl) {
      setSelectedSpaceIcon(localMatch.iconUrl);
      return;
    }

    let alive = true;
    (async () => {
      try {
        const res = await fetch(
          `${baseUrl}/rest/api/space/${encodeURIComponent(filterSpace)}?expand=icon`,
          { credentials: 'include' },
        );
        if (!res.ok || !alive) return;
        const data = await res.json();
        const iconPath = data?.icon?.path || '';
        if (iconPath) {
          setSelectedSpaceIcon(resolveConfluenceIconUrl(baseUrl, iconPath, fallbackSpaceIcon));
        }
      } catch {
        // non-fatal
      }
    })();

    return () => {
      alive = false;
    };
  }, [filterSpace, spaceOptions, baseUrl]);

  useEffect(() => {
    if (!filterContributor) {
      setSelectedContributorIcon('');
      return;
    }
    const localMatch = contributorOptions.find((user) => user.key === filterContributor);
    if (localMatch?.avatarUrl) {
      setSelectedContributorIcon(localMatch.avatarUrl);
      return;
    }

    let alive = true;
    (async () => {
      const tryUrls = [
        `${baseUrl}/rest/api/user?accountId=${encodeURIComponent(filterContributor)}`,
        `${baseUrl}/rest/api/user?username=${encodeURIComponent(filterContributor)}`,
        `${baseUrl}/rest/api/user?key=${encodeURIComponent(filterContributor)}`,
      ];
      for (let idx = 0; idx < tryUrls.length; idx += 1) {
        try {
          const res = await fetch(tryUrls[idx], { credentials: 'include' });
          if (!res.ok || !alive) continue;
          const data = await res.json();
          const iconPath = data?.profilePicture?.path || '';
          if (!iconPath) continue;
          setSelectedContributorIcon(resolveConfluenceIconUrl(baseUrl, iconPath, fallbackUserIcon));
          return;
        } catch {
          // try next endpoint
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [filterContributor, contributorOptions, baseUrl]);

  useEffect(() => {
    const onDocMouseDown = (e) => {
      if (spaceBoxRef.current && !spaceBoxRef.current.contains(e.target)) {
        setSpaceDropdownOpen(false);
        setSpaceActiveIndex(-1);
      }
      if (contributorBoxRef.current && !contributorBoxRef.current.contains(e.target)) {
        setContributorDropdownOpen(false);
        setContributorActiveIndex(-1);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  useEffect(() => {
    const local = spaceOptions.filter((s) => {
      const q = spaceInput.trim().toLowerCase();
      return !q || s.name.toLowerCase().includes(q) || s.key.toLowerCase().includes(q);
    });
    setSpaceSuggestions(local.slice(0, 20));
    setSpaceActiveIndex(-1);
  }, [spaceInput, spaceOptions]);

  useEffect(() => {
    const term = spaceInput.trim();
    if (term.length < 2) {
      setSpaceLookupLoading(false);
      return undefined;
    }
    const reqId = ++spaceReqIdRef.current;
    const handle = setTimeout(async () => {
      try {
        setSpaceLookupLoading(true);
        const remote = await searchSpacesByQuery(baseUrl, term, 10);
        if (reqId !== spaceReqIdRef.current) return;
        setSpaceSuggestions((prev) => {
          const merged = [...prev, ...remote];
          return dedupeByKey(merged, 'key').sort((a, b) => a.name.localeCompare(b.name)).slice(0, 20);
        });
      } catch {
        // non-fatal
      } finally {
        if (reqId === spaceReqIdRef.current) setSpaceLookupLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [spaceInput, baseUrl]);

  useEffect(() => {
    const local = contributorOptions.filter((c) => {
      const q = contributorInput.trim().toLowerCase();
      return !q || c.name.toLowerCase().includes(q) || c.key.toLowerCase().includes(q);
    });
    setContributorSuggestions(local.slice(0, 20));
    setContributorActiveIndex(-1);
  }, [contributorInput, contributorOptions]);

  useEffect(() => {
    const term = contributorInput.trim();
    if (term.length < 2) {
      setContributorLookupLoading(false);
      return undefined;
    }
    const reqId = ++contributorReqIdRef.current;
    const handle = setTimeout(async () => {
      try {
        setContributorLookupLoading(true);
        const remote = await searchUsersByQuery(baseUrl, term, 10);
        if (reqId !== contributorReqIdRef.current) return;
        setContributorSuggestions((prev) => {
          const merged = [...prev, ...remote];
          return dedupeByKey(merged, 'key').sort((a, b) => a.name.localeCompare(b.name)).slice(0, 20);
        });
      } catch {
        // non-fatal
      } finally {
        if (reqId === contributorReqIdRef.current) setContributorLookupLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [contributorInput, baseUrl]);

  useEffect(() => {
    if (!spaceDropdownOpen) setSpaceActiveIndex(-1);
  }, [spaceDropdownOpen]);

  useEffect(() => {
    if (!contributorDropdownOpen) setContributorActiveIndex(-1);
  }, [contributorDropdownOpen]);

  useEffect(() => {
    const maxIndex = Math.max(-1, spaceSuggestions.length - 1);
    if (spaceActiveIndex > maxIndex) {
      setSpaceActiveIndex(maxIndex);
    }
  }, [spaceSuggestions, spaceActiveIndex]);

  useEffect(() => {
    const maxIndex = Math.max(-1, contributorSuggestions.length - 1);
    if (contributorActiveIndex > maxIndex) {
      setContributorActiveIndex(maxIndex);
    }
  }, [contributorSuggestions, contributorActiveIndex]);

  useEffect(() => {
    if (!spaceDropdownOpen || spaceActiveIndex < 0) return;
    const highlighted = spaceBoxRef.current?.querySelector('.space-options .combo-option.highlighted');
    highlighted?.scrollIntoView({ block: 'nearest' });
  }, [spaceDropdownOpen, spaceActiveIndex, spaceSuggestions]);

  useEffect(() => {
    if (!contributorDropdownOpen || contributorActiveIndex < 0) return;
    const highlighted = contributorBoxRef.current?.querySelector('.contributor-options .combo-option.highlighted');
    highlighted?.scrollIntoView({ block: 'nearest' });
  }, [contributorDropdownOpen, contributorActiveIndex, contributorSuggestions]);

  const treeRoots = useMemo(() => buildTree(filteredResults, baseUrl), [filteredResults, baseUrl]);

  useEffect(() => {
    if (view !== 'tree') setTreeTooltipData(null);
  }, [view]);

  useEffect(() => {
    if (!treeTooltipData) return;
    requestAnimationFrame(() => {
      positionTreeTooltip(treeTooltipPointerRef.current.x, treeTooltipPointerRef.current.y);
    });
  }, [treeTooltipData]);

  const tableColumns = useMemo(() => {
    const cols = [
      { key: 'type', label: 'Type', sortable: true },
      { key: 'name', label: 'Name', sortable: true },
      { key: 'space', label: 'Space', sortable: true },
      { key: 'contributor', label: 'Contributor', sortable: true },
      { key: 'created', label: 'Created', sortable: true },
      { key: 'modified', label: 'Modified', sortable: true },
    ];
    if (enableSummaries) cols.push({ key: 'ai', label: 'AI', sortable: false });
    return cols;
  }, [enableSummaries]);

  const tableResults = useMemo(() => {
    if (!tableSort.key || !TABLE_SORTABLE_COLUMNS.has(tableSort.key)) return filteredResults;

    const directionFactor = tableSort.direction === 'desc' ? -1 : 1;
    return filteredResults
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        const aValue = getTableSortValue(a.item, tableSort.key);
        const bValue = getTableSortValue(b.item, tableSort.key);
        const aMissing = aValue === null || aValue === '';
        const bMissing = bValue === null || bValue === '';
        if (aMissing && bMissing) return a.index - b.index;
        if (aMissing) return 1;
        if (bMissing) return -1;

        let cmp = 0;
        if (typeof aValue === 'number' && typeof bValue === 'number') {
          cmp = aValue - bValue;
        } else {
          cmp = String(aValue).localeCompare(String(bValue), undefined, { numeric: true, sensitivity: 'base' });
        }
        if (cmp === 0) return a.index - b.index;
        return cmp * directionFactor;
      })
      .map((entry) => entry.item);
  }, [filteredResults, tableSort]);

  const tableMinWidth = useMemo(
    () => tableColumns.reduce((sum, col) => sum + (tableColWidths[col.key] || DEFAULT_TABLE_COL_WIDTHS[col.key] || 120), 0),
    [tableColumns, tableColWidths],
  );

  const isInitialSearching = (initialSearchPending || loading) && allResults.length === 0 && !!searchText;

  const fetchMore = async () => {
    if (!searchText || !baseUrl || loading || allLoaded || inflightRef.current) return;
    const isInitialFetch = start === 0 && allResults.length === 0;
    const requestSignature = activeSearchSignature;
    const requestId = searchFetchRequestIdRef.current + 1;
    searchFetchRequestIdRef.current = requestId;

    if (searchFetchAbortRef.current) {
      searchFetchAbortRef.current.abort();
    }

    const controller = new AbortController();
    searchFetchAbortRef.current = controller;
    activeSearchSignatureRef.current = requestSignature;
    inflightRef.current = true;
    setLoading(true);

    try {
      const cql = cqlFromState(searchText, filterType, filterDate, filterSpace, filterContributor);
      const url = `${baseUrl}/rest/api/content/search?cql=${cql}&limit=${resultsPerRequest}&start=${start}&expand=ancestors,space.icon,history.createdBy,version`;

      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const data = await res.json();
      const list = Array.isArray(data.results) ? data.results : [];
      const total = Number.isInteger(data.totalSize) ? data.totalSize : 0;

      if (
        searchFetchRequestIdRef.current !== requestId
        || activeSearchSignatureRef.current !== requestSignature
      ) {
        return;
      }

      setTotalSize(total);
      setLastFetchAt(Date.now());

      setAllResults((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        const merged = prev.slice();
        list.forEach((item) => {
          if (!seen.has(item.id)) merged.push(item);
        });
        return merged;
      });

      const nextStart = start + list.length;
      setStart(nextStart);
      if (list.length === 0 || nextStart >= total) setAllLoaded(true);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.error('[V2 Preact] Search failed:', err);
      openNoticeDialog({
        title: 'Search Failed',
        message: err.message || 'Unknown error',
        tone: 'error',
      });
    } finally {
      if (
        searchFetchRequestIdRef.current === requestId
        && activeSearchSignatureRef.current === requestSignature
      ) {
        inflightRef.current = false;
        setLoading(false);
        if (isInitialFetch) setInitialSearchPending(false);
      }
      if (searchFetchAbortRef.current === controller) {
        searchFetchAbortRef.current = null;
      }
    }
  };

  useEffect(() => {
    fetchMoreRef.current = fetchMore;
  }, [fetchMore]);

  useEffect(() => {
    if (!searchText || loading || allLoaded || !initialSearchPending) return;
    if (start !== 0 || allResults.length !== 0) return;
    fetchMore();
  }, [searchText, baseUrl, resultsPerRequest, filterDate, filterType, filterSpace, filterContributor, start, allResults.length, loading, allLoaded, initialSearchPending]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const onScroll = () => {
      const nearBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 12;
      if (nearBottom && typeof fetchMoreRef.current === 'function') {
        fetchMoreRef.current();
      }
      setShowScrollTop(scroller.scrollTop > 250);
    };

    scroller.addEventListener('scroll', onScroll);
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!shouldFocusSearchFromQuery || didAutoFocusSearchRef.current) return;
    let clearAttentionTimer = null;
    const timer = setTimeout(() => {
      const input = searchInputRef.current;
      if (!input) return;
      input.focus();
      setSearchInputAttention(true);
      clearAttentionTimer = setTimeout(() => setSearchInputAttention(false), 5600);
      didAutoFocusSearchRef.current = true;
    }, 0);
    return () => {
      clearTimeout(timer);
      if (clearAttentionTimer) clearTimeout(clearAttentionTimer);
    };
  }, [shouldFocusSearchFromQuery]);

  const runSearch = () => {
    const next = searchInput.trim();
    if (!next) {
      openNoticeDialog({
        title: 'Search Query Required',
        message: 'Please enter a search query.',
        tone: 'info',
      });
      return;
    }

    setInitialSearchPending(true);
    resetLoadedData();
    setSearchText(next);
    updateUrlParams({
      searchText: next,
      baseUrl,
      text: filterText.trim(),
      space: filterSpace ? `${filterSpace}:${spaceInput.trim() || filterSpace}` : '',
      contributor: filterContributor ? `${filterContributor}:${contributorInput.trim() || filterContributor}` : '',
      date: filterDate,
      type: filterType,
    });
  };

  const applySpaceFilter = (space) => {
    const nextKey = space?.key || '';
    const nextLabel = space?.name || '';
    setFilterSpace(nextKey);
    setSpaceInput(nextLabel);
    setSelectedSpaceIcon(space?.iconUrl || '');
    setSpaceDropdownOpen(false);
    setSpaceActiveIndex(-1);
    updateUrlParams({
      searchText,
      baseUrl,
      text: filterText.trim(),
      space: nextKey ? `${nextKey}:${nextLabel || nextKey}` : '',
      contributor: filterContributor ? `${filterContributor}:${contributorInput.trim() || filterContributor}` : '',
      date: filterDate,
      type: filterType,
    });
  };

  const applyContributorFilter = (contributor) => {
    const nextKey = contributor?.key || '';
    const nextLabel = contributor?.name || '';
    setFilterContributor(nextKey);
    setContributorInput(nextLabel);
    setSelectedContributorIcon(contributor?.avatarUrl || '');
    setContributorDropdownOpen(false);
    setContributorActiveIndex(-1);
    updateUrlParams({
      searchText,
      baseUrl,
      text: filterText.trim(),
      space: filterSpace ? `${filterSpace}:${spaceInput.trim() || filterSpace}` : '',
      contributor: nextKey ? `${nextKey}:${nextLabel || nextKey}` : '',
      date: filterDate,
      type: filterType,
    });
  };

  const handleSpaceInputKeyDown = (event) => {
    const totalOptions = spaceSuggestions.length;
    if (totalOptions <= 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!spaceDropdownOpen) setSpaceDropdownOpen(true);
      setSpaceActiveIndex((prev) => Math.min(totalOptions - 1, Math.max(0, prev + 1)));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!spaceDropdownOpen) setSpaceDropdownOpen(true);
      setSpaceActiveIndex((prev) => Math.max(0, prev <= 0 ? 0 : prev - 1));
      return;
    }

    if (event.key === 'Enter' && spaceDropdownOpen && spaceActiveIndex >= 0) {
      event.preventDefault();
      applySpaceFilter(spaceSuggestions[spaceActiveIndex] || null);
      return;
    }

    if (event.key === 'Escape') {
      setSpaceDropdownOpen(false);
      setSpaceActiveIndex(-1);
    }
  };

  const handleContributorInputKeyDown = (event) => {
    const totalOptions = contributorSuggestions.length;
    if (totalOptions <= 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!contributorDropdownOpen) setContributorDropdownOpen(true);
      setContributorActiveIndex((prev) => Math.min(totalOptions - 1, Math.max(0, prev + 1)));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!contributorDropdownOpen) setContributorDropdownOpen(true);
      setContributorActiveIndex((prev) => Math.max(0, prev <= 0 ? 0 : prev - 1));
      return;
    }

    if (event.key === 'Enter' && contributorDropdownOpen && contributorActiveIndex >= 0) {
      event.preventDefault();
      applyContributorFilter(contributorSuggestions[contributorActiveIndex] || null);
      return;
    }

    if (event.key === 'Escape') {
      setContributorDropdownOpen(false);
      setContributorActiveIndex(-1);
    }
  };

  const toggleNode = (id) => {
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const positionTreeTooltip = (x, y) => {
    const tip = treeTooltipRef.current;
    if (!tip) return;
    const pad = 12;
    const tipWidth = tip.offsetWidth || 340;
    const tipHeight = tip.offsetHeight || 180;
    let left = x + 14;
    let top = y + 14;
    if (left + tipWidth > window.innerWidth - pad) {
      left = Math.max(pad, x - tipWidth - 14);
    }
    if (top + tipHeight > window.innerHeight - pad) {
      top = Math.max(pad, y - tipHeight - 14);
    }
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };

  const showTreeTooltip = (event, node, showTreeTooltips) => {
    if (!showTreeTooltips || !node) return;
    const source = node.sourceItem || {};
    const contributor = source.history?.createdBy?.displayName || 'Unknown';
    const modified = formatDate(source.version?.when);
    const type = source.type || node.type || 'page';
    const spaceName = source.space?.name || 'Unknown space';
    const spaceIconUrl = resolveConfluenceIconUrl(baseUrl, source.space?.icon?.path || '', fallbackSpaceIcon);
    const avatarUrl = resolveConfluenceIconUrl(baseUrl, source.history?.createdBy?.profilePicture?.path || '', fallbackUserIcon);

    treeTooltipPointerRef.current = { x: event.clientX, y: event.clientY };
    setTreeTooltipData({
      title: node.title || source.title || 'Untitled',
      url: node.url || buildConfluenceUrl(baseUrl, source._links?.webui),
      type,
      contributor,
      modified,
      spaceName,
      spaceIconUrl,
      avatarUrl,
    });
  };

  const moveTreeTooltip = (event, node, showTreeTooltips) => {
    if (!showTreeTooltips || !node || !treeTooltipRef.current) return;
    treeTooltipPointerRef.current = { x: event.clientX, y: event.clientY };
    positionTreeTooltip(event.clientX, event.clientY);
  };

  const hideTreeTooltip = () => {
    setTreeTooltipData(null);
  };

  const handleTreeViewClick = () => {
    if (view !== 'tree') {
      setView('tree');
      return;
    }

    const expandableIds = collectExpandableNodeIds(treeRoots);
    if (expandableIds.length === 0) return;

    setCollapsedNodes((prev) => {
      const hasExpandedNodes = expandableIds.some((id) => !prev.has(id));
      const next = new Set(prev);
      if (hasExpandedNodes) {
        expandableIds.forEach((id) => next.add(id));
      } else {
        expandableIds.forEach((id) => next.delete(id));
      }
      return next;
    });
  };

  const startTableColumnResize = (event, columnKey) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = tableColWidths[columnKey] || DEFAULT_TABLE_COL_WIDTHS[columnKey] || 120;

    const onMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = Math.max(MIN_TABLE_COL_WIDTH, startWidth + delta);
      setTableColWidths((prev) => {
        const next = { ...prev, [columnKey]: nextWidth };
        sessionStorage.setItem('v2TableColWidths', JSON.stringify(next));
        return next;
      });
    };

    const onStop = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onStop);
      document.body.style.cursor = '';
    };

    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onStop);
  };

  const resetTableColumnWidth = (columnKey) => {
    setTableColWidths((prev) => {
      const next = { ...prev, [columnKey]: DEFAULT_TABLE_COL_WIDTHS[columnKey] || 120 };
      sessionStorage.setItem('v2TableColWidths', JSON.stringify(next));
      return next;
    });
  };

  const toggleTableSort = (columnKey) => {
    if (!TABLE_SORTABLE_COLUMNS.has(columnKey)) return;
    setTableSort((prev) => {
      if (prev.key !== columnKey) return { key: columnKey, direction: 'asc' };
      if (prev.direction === 'asc') return { key: columnKey, direction: 'desc' };
      return { key: '', direction: 'asc' };
    });
  };

  const applySavedSearchEntry = (entry) => {
    const nextBase = (entry.baseUrl || baseUrl).trim();
    const nextSearchText = (entry.searchText || '').trim();
    if (!nextBase || !nextSearchText) {
      openNoticeDialog({
        title: 'Saved Search Is Invalid',
        message: 'Saved search is missing base URL or query.',
        tone: 'error',
      });
      return false;
    }

    const nextDate = entry.filters?.date || 'any';
    const nextType = entry.filters?.type || '';

    setInitialSearchPending(true);
    resetLoadedData();
    setBaseUrl(nextBase);
    setSearchInput(nextSearchText);
    setSearchText(nextSearchText);
    setFilterText(entry.filters?.text?.key || '');
    setFilterSpace(entry.filters?.space?.key || '');
    setSpaceInput(entry.filters?.space?.label || entry.filters?.space?.key || '');
    setSelectedSpaceIcon('');
    setFilterContributor(entry.filters?.contributor?.key || '');
    setContributorInput(entry.filters?.contributor?.label || entry.filters?.contributor?.key || '');
    setSelectedContributorIcon('');
    setFilterDate(nextDate);
    setFilterType(nextType);

    updateUrlParams({
      searchText: nextSearchText,
      baseUrl: nextBase,
      text: entry.filters?.text?.key || '',
      space: entry.filters?.space?.key ? `${entry.filters.space.key}:${entry.filters?.space?.label || entry.filters.space.key}` : '',
      contributor: entry.filters?.contributor?.key ? `${entry.filters.contributor.key}:${entry.filters?.contributor?.label || entry.filters.contributor.key}` : '',
      date: nextDate,
      type: nextType,
    });

    return true;
  };

  const updateFilterDate = (nextDate) => {
    setFilterDate(nextDate);
    updateUrlParams({
      searchText,
      baseUrl,
      text: filterText.trim(),
      space: filterSpace ? `${filterSpace}:${spaceInput.trim() || filterSpace}` : '',
      contributor: filterContributor ? `${filterContributor}:${contributorInput.trim() || filterContributor}` : '',
      date: nextDate,
      type: filterType,
    });
  };

  const updateFilterType = (nextType) => {
    setFilterType(nextType);
    updateUrlParams({
      searchText,
      baseUrl,
      text: filterText.trim(),
      space: filterSpace ? `${filterSpace}:${spaceInput.trim() || filterSpace}` : '',
      contributor: filterContributor ? `${filterContributor}:${contributorInput.trim() || filterContributor}` : '',
      date: filterDate,
      type: nextType,
    });
  };

  const scrollToTop = () => {
    scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return {
    state: {
      baseUrl,
      searchInput,
      searchText,
      searchInputAttention,
      domainName,
      view,
      loading,
      allLoaded,
      totalSize,
      lastFetchAt,
      filterText,
      filterSpace,
      spaceInput,
      selectedSpaceIcon,
      spaceSuggestions,
      spaceDropdownOpen,
      spaceActiveIndex,
      spaceLookupLoading,
      filterContributor,
      contributorInput,
      selectedContributorIcon,
      contributorSuggestions,
      contributorDropdownOpen,
      contributorActiveIndex,
      contributorLookupLoading,
      filterDate,
      filterType,
      collapsedNodes,
      showScrollTop,
      treeTooltipData,
      tableColWidths,
      tableSort,
      isInitialSearching,
    },
    derived: {
      allResults,
      filteredResults,
      spaceOptions,
      contributorOptions,
      treeRoots,
      tableColumns,
      tableResults,
      tableMinWidth,
    },
    refs: {
      scrollerRef,
      treeTooltipRef,
      spaceBoxRef,
      contributorBoxRef,
      searchInputRef,
    },
    actions: {
      setBaseUrl,
      setSearchInput,
      setSearchText,
      setFilterText,
      setSpaceInput,
      setFilterSpace,
      setContributorInput,
      setFilterContributor,
      setView,
      setSpaceDropdownOpen,
      setContributorDropdownOpen,
      setSpaceActiveIndex,
      setContributorActiveIndex,
      runSearch,
      applySpaceFilter,
      applyContributorFilter,
      handleSpaceInputKeyDown,
      handleContributorInputKeyDown,
      toggleNode,
      showTreeTooltip,
      moveTreeTooltip,
      hideTreeTooltip,
      handleTreeViewClick,
      startTableColumnResize,
      resetTableColumnWidth,
      toggleTableSort,
      updateFilterDate,
      updateFilterType,
      applySavedSearchEntry,
      resetLoadedData,
      scrollToTop,
      setTreeTooltipData,
    },
  };
}
