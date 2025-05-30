// =========================================================
//                    GLOBAL STATE
// =========================================================
import { DEFAULT_COL_WIDTHS } from './config.js';

export let searchText = '', baseUrl = '', domainName = '';
export let nodeMap = {}, roots = [], searchResultIds = new Set();
export let allExpanded = true, collapsedNodes = new Set();
export let loading = false, isFetching = false, allResultsLoaded = false;
export let start = 0, totalSize = null;
export let allResults = [], filteredResults = [];
export let fullSpaceList = [], fullContributorList = [];
export const conversationHistories = new Map();
export let currentSortColumn = '', currentSortOrder = '';
export let treeTooltipSettings = { showTooltips: true };
export let tableTooltipSettings = { showTooltips: true };
export const confluenceBodyCache = new Map(), summaryCache = new Map();
export const tooltipBoundNodes = new WeakMap();
export let lastTextFilter = '', lastSpaceKey = '', lastContributorKey = '';
export let colWidths = [...DEFAULT_COL_WIDTHS];
export let currentScrollTarget = null;
export let ENABLE_SUMMARIES = true; // Will be updated from storage

// Setters for state variables if direct modification from other modules is complex
export function setSearchText(value) { searchText = value; }
export function setBaseUrl(value) { baseUrl = value; }
export function setDomainName(value) { domainName = value; }
export function setNodeMap(value) { nodeMap = value; }
export function setRoots(value) { roots = value; }
export function setSearchResultIds(value) { searchResultIds = value; }
export function setAllExpanded(value) { allExpanded = value; }
export function setCollapsedNodes(value) { collapsedNodes = value; }
export function setLoading(value) { loading = value; }
export function setIsFetching(value) { isFetching = value; }
export function setAllResultsLoaded(value) { allResultsLoaded = value; }
export function setStart(value) { start = value; }
export function setTotalSize(value) { totalSize = value; }
export function setAllResults(value) { allResults = value; }
export function setFilteredResults(value) { filteredResults = value; }
export function setFullSpaceList(value) { fullSpaceList = value; }
export function setFullContributorList(value) { fullContributorList = value; }
export function setCurrentSortColumn(value) { currentSortColumn = value; }
export function setCurrentSortOrder(value) { currentSortOrder = value; }
export function setTreeTooltipSettings(value) { treeTooltipSettings = value; }
export function setTableTooltipSettings(value) { tableTooltipSettings = value; }
export function setLastTextFilter(value) { lastTextFilter = value; }
export function setLastSpaceKey(value) { lastSpaceKey = value; }
export function setLastContributorKey(value) { lastContributorKey = value; }
export function setColWidths(value) { colWidths = value; }
export function setCurrentScrollTarget(value) { currentScrollTarget = value; }
export function setEnableSummaries(value) { ENABLE_SUMMARIES = value; }