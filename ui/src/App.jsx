import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  AI_MODEL_OPTIONS,
  DEFAULT_AI_MODEL,
  retiredModelFallbacks,
} from './shared/constants.js';
import { AiModal } from './components/AiModal.jsx';
import { SavedSearchModal } from './components/SavedSearchModal.jsx';
import { ConfirmDialog, NoticeDialog, SaveNameDialog } from './components/Dialogs.jsx';
import { getSync, setSync, subscribeStorageChanges } from './services/storage.js';
import {
  AI_FONT_SIZE_STEP_PX,
  DEFAULT_TABLE_COL_WIDTHS,
  MAX_AI_CHAT_FONT_SIZE_PX,
  MAX_AI_SUMMARY_FONT_SIZE_PX,
  MIN_AI_CHAT_FONT_SIZE_PX,
  MIN_AI_SUMMARY_FONT_SIZE_PX,
  fallbackSpaceIcon,
  fallbackUserIcon,
  typeIcons,
  typeLabels,
} from './features/app/constants.js';
import { sanitizeHtmlFragment } from './features/app/utils/htmlUtils.js';
import { detectDirection, detectDirectionFromHtml, formatDate } from './features/app/utils/textUtils.js';
import {
  buildConfluenceUrl,
  getQueryParams,
  resolveConfluenceIconUrl,
} from './features/app/utils/urlUtils.js';
import { useSearchResultsController } from './features/app/controllers/useSearchResultsController.js';
import { useAiSummaryController } from './features/app/controllers/useAiSummaryController.js';
import { useSavedSearchesController } from './features/app/controllers/useSavedSearchesController.js';
import { TopBarSearch } from './features/app/components/TopBarSearch.jsx';
import { SidebarPanel } from './features/app/components/SidebarPanel.jsx';
import { ResultsPanel } from './features/app/components/ResultsPanel.jsx';
import { TreeTooltip } from './features/app/components/TreeTooltip.jsx';

export function App() {
  const params = getQueryParams();
  const modalOnlyMode = params.mode === 'content-modal';
  const modalContentId = (params.contentId || '').trim();
  const modalContentTitle = (params.contentTitle || '').trim();
  const modalContentType = (params.contentType || '').trim();
  const modalContentWebUi = (params.contentWebUi || '').trim();
  const modalSpaceName = (params.spaceName || '').trim();
  const modalSpaceKey = (params.spaceKey || '').trim();
  const modalSpaceIconPath = (params.spaceIconPath || '').trim();
  const modalContributorName = (params.contributorName || '').trim();
  const modalContributorUsername = (params.contributorUsername || '').trim();
  const modalContributorAvatarPath = (params.contributorAvatarPath || '').trim();
  const modalModifiedWhen = (params.modifiedWhen || '').trim();

  const [isDarkMode, setIsDarkMode] = useState(false);
  const [selectedAiModel, setSelectedAiModel] = useState(DEFAULT_AI_MODEL);
  const [resultsPerRequest, setResultsPerRequest] = useState(75);
  const [enableSummaries, setEnableSummaries] = useState(true);
  const [highlightResultRows, setHighlightResultRows] = useState(true);
  const [showTreeTooltips, setShowTreeTooltips] = useState(true);
  const [showTableTooltips, setShowTableTooltips] = useState(true);

  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    danger: false,
  });
  const [noticeDialog, setNoticeDialog] = useState({
    open: false,
    title: '',
    message: '',
    tone: 'info',
  });

  const confirmDialogResolverRef = useRef(null);

  const openConfirmDialog = ({
    title,
    message,
    confirmLabel = 'Confirm',
    danger = false,
  }) => new Promise((resolve) => {
    confirmDialogResolverRef.current = resolve;
    setConfirmDialog({
      open: true,
      title,
      message,
      confirmLabel,
      danger,
    });
  });

  const closeConfirmDialog = (value = false) => {
    const resolver = confirmDialogResolverRef.current;
    confirmDialogResolverRef.current = null;
    setConfirmDialog((prev) => ({ ...prev, open: false }));
    if (typeof resolver === 'function') resolver(Boolean(value));
  };

  const openNoticeDialog = ({
    title = 'Notice',
    message = '',
    tone = 'info',
  }) => {
    setNoticeDialog({
      open: true,
      title,
      message,
      tone: ['info', 'success', 'error'].includes(tone) ? tone : 'info',
    });
  };

  const closeNoticeDialog = () => {
    setNoticeDialog((prev) => ({ ...prev, open: false }));
  };

  const search = useSearchResultsController({
    params,
    resultsPerRequest,
    enableSummaries,
    openNoticeDialog,
  });

  const ai = useAiSummaryController({
    baseUrl: search.state.baseUrl,
    modalOnlyMode,
    modalContentId,
    modalContentTitle,
    modalContentType,
    modalContentWebUi,
    modalSpaceName,
    modalSpaceKey,
    modalSpaceIconPath,
    modalContributorName,
    modalContributorUsername,
    modalContributorAvatarPath,
    modalModifiedWhen,
    enableSummaries,
    allResults: search.derived.allResults,
    openNoticeDialog,
    openConfirmDialog,
  });

  const saved = useSavedSearchesController({
    baseUrl: search.state.baseUrl,
    searchText: search.state.searchText,
    filterText: search.state.filterText,
    filterSpace: search.state.filterSpace,
    spaceInput: search.state.spaceInput,
    filterContributor: search.state.filterContributor,
    contributorInput: search.state.contributorInput,
    filterDate: search.state.filterDate,
    filterType: search.state.filterType,
    spaceOptions: search.derived.spaceOptions,
    contributorOptions: search.derived.contributorOptions,
    openNoticeDialog,
    openConfirmDialog,
    onRunSavedSearch: search.actions.applySavedSearchEntry,
  });

  useEffect(() => {
    document.body.classList.toggle('modal-only-frame', modalOnlyMode);
    return () => document.body.classList.remove('modal-only-frame');
  }, [modalOnlyMode]);

  useEffect(() => {
    let currentDarkModePreference = false;
    let currentSyncThemeToConfluencePage = false;

    const applyThemeFromPreferences = () => {
      const shouldApplyDarkMode = currentDarkModePreference && (!modalOnlyMode || currentSyncThemeToConfluencePage);
      setIsDarkMode(shouldApplyDarkMode);
      document.body.classList.toggle('dark-mode', shouldApplyDarkMode);
    };

    const loadSettings = async () => {
      const data = await getSync(['darkMode', 'syncThemeToConfluencePage', 'resultsPerRequest', 'enableAiFeatures', 'enableSummaries', 'selectedAiModel', 'highlightResultRows', 'showTooltips', 'showTreeTooltips', 'showTableTooltips']);
      currentDarkModePreference = !!data.darkMode;
      currentSyncThemeToConfluencePage = data.syncThemeToConfluencePage === true;
      applyThemeFromPreferences();
      if (Number.isInteger(data.resultsPerRequest)) setResultsPerRequest(data.resultsPerRequest);
      const hasAiFeaturesFlag = typeof data.enableAiFeatures === 'boolean';
      setEnableSummaries(hasAiFeaturesFlag ? data.enableAiFeatures === true : data.enableSummaries !== false);
      setHighlightResultRows(data.highlightResultRows !== false);
      const legacyTooltip = data.showTooltips;
      setShowTreeTooltips((data.showTreeTooltips ?? legacyTooltip) !== false);
      setShowTableTooltips((data.showTableTooltips ?? legacyTooltip) !== false);

      const requestedModel = retiredModelFallbacks[data.selectedAiModel] || data.selectedAiModel || DEFAULT_AI_MODEL;
      setSelectedAiModel(requestedModel);
      if (data.selectedAiModel && requestedModel !== data.selectedAiModel) {
        void setSync({ selectedAiModel: requestedModel });
      }
    };

    loadSettings();

    const onStorage = (changes, area) => {
      if (area !== 'sync') return;
      if (changes.darkMode) {
        currentDarkModePreference = !!changes.darkMode.newValue;
        applyThemeFromPreferences();
      }
      if (changes.syncThemeToConfluencePage) {
        currentSyncThemeToConfluencePage = changes.syncThemeToConfluencePage.newValue === true;
        applyThemeFromPreferences();
      }
      if (changes.resultsPerRequest && Number.isInteger(changes.resultsPerRequest.newValue)) {
        setResultsPerRequest(changes.resultsPerRequest.newValue);
      }
      if (changes.enableAiFeatures) {
        setEnableSummaries(changes.enableAiFeatures.newValue === true);
      } else if (changes.enableSummaries) {
        setEnableSummaries(changes.enableSummaries.newValue !== false);
      }
      if (changes.highlightResultRows) setHighlightResultRows(changes.highlightResultRows.newValue !== false);
      if (changes.showTooltips && !changes.showTreeTooltips) {
        setShowTreeTooltips(changes.showTooltips.newValue !== false);
      }
      if (changes.showTooltips && !changes.showTableTooltips) {
        setShowTableTooltips(changes.showTooltips.newValue !== false);
      }
      if (changes.showTreeTooltips) setShowTreeTooltips(changes.showTreeTooltips.newValue !== false);
      if (changes.showTableTooltips) setShowTableTooltips(changes.showTableTooltips.newValue !== false);
      if (changes.selectedAiModel) {
        const nextModel = retiredModelFallbacks[changes.selectedAiModel.newValue]
          || changes.selectedAiModel.newValue
          || DEFAULT_AI_MODEL;
        setSelectedAiModel(nextModel);
        if (nextModel !== changes.selectedAiModel.newValue) {
          void setSync({ selectedAiModel: nextModel });
        }
      }
    };

    const unsubscribe = subscribeStorageChanges(onStorage);
    return unsubscribe;
  }, [modalOnlyMode]);

  useEffect(() => {
    if (!showTreeTooltips) search.actions.setTreeTooltipData(null);
  }, [showTreeTooltips]);

  useEffect(() => {
    if (!confirmDialog.open) return undefined;
    const onEscape = (e) => {
      if (e.key === 'Escape') closeConfirmDialog(false);
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [confirmDialog.open]);

  useEffect(() => {
    if (!noticeDialog.open) return undefined;
    const onEscape = (e) => {
      if (e.key === 'Escape') closeNoticeDialog();
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [noticeDialog.open]);

  useEffect(() => () => {
    if (confirmDialogResolverRef.current) {
      confirmDialogResolverRef.current(false);
      confirmDialogResolverRef.current = null;
    }
  }, []);

  const openOptions = () => {
    if (chrome.runtime?.openOptionsPage) chrome.runtime.openOptionsPage();
  };

  const toggleDarkMode = () => {
    const nextDarkMode = !isDarkMode;
    setIsDarkMode(nextDarkMode);
    document.body.classList.toggle('dark-mode', nextDarkMode);
    void setSync({ darkMode: nextDarkMode });
  };

  const changeAiModel = (nextModel) => {
    const normalized = retiredModelFallbacks[nextModel] || nextModel || DEFAULT_AI_MODEL;
    setSelectedAiModel(normalized);
    void setSync({ selectedAiModel: normalized });
  };

  const aiModelOptions = useMemo(() => {
    if (AI_MODEL_OPTIONS.some((opt) => opt.value === selectedAiModel)) return AI_MODEL_OPTIONS;
    return [{ value: selectedAiModel, label: `${selectedAiModel} (custom)` }, ...AI_MODEL_OPTIONS];
  }, [selectedAiModel]);

  return (
    <div class={`v2-root ${modalOnlyMode ? 'modal-only' : ''}`}>
      <TopBarSearch
        domainName={search.state.domainName}
        isDarkMode={isDarkMode}
        toggleDarkMode={toggleDarkMode}
        openOptions={openOptions}
        searchInputAttention={search.state.searchInputAttention}
        searchInputRef={search.refs.searchInputRef}
        searchInput={search.state.searchInput}
        setSearchInput={search.actions.setSearchInput}
        runSearch={search.actions.runSearch}
      />

      <main class="content-grid">
        <SidebarPanel
          view={search.state.view}
          handleTreeViewClick={search.actions.handleTreeViewClick}
          setView={search.actions.setView}
          saveCurrentSearch={saved.actions.saveCurrentSearch}
          openSavedSearches={saved.actions.openSavedSearches}
          filterText={search.state.filterText}
          setFilterText={search.actions.setFilterText}
          spaceBoxRef={search.refs.spaceBoxRef}
          filterSpace={search.state.filterSpace}
          selectedSpaceIcon={search.state.selectedSpaceIcon}
          fallbackSpaceIcon={fallbackSpaceIcon}
          spaceInput={search.state.spaceInput}
          setSpaceInput={search.actions.setSpaceInput}
          setFilterSpace={search.actions.setFilterSpace}
          setSpaceDropdownOpen={search.actions.setSpaceDropdownOpen}
          setSpaceActiveIndex={search.actions.setSpaceActiveIndex}
          spaceDropdownOpen={search.state.spaceDropdownOpen}
          handleSpaceInputKeyDown={search.actions.handleSpaceInputKeyDown}
          applySpaceFilter={search.actions.applySpaceFilter}
          spaceLookupLoading={search.state.spaceLookupLoading}
          spaceSuggestions={search.state.spaceSuggestions}
          spaceActiveIndex={search.state.spaceActiveIndex}
          contributorBoxRef={search.refs.contributorBoxRef}
          filterContributor={search.state.filterContributor}
          selectedContributorIcon={search.state.selectedContributorIcon}
          fallbackUserIcon={fallbackUserIcon}
          contributorInput={search.state.contributorInput}
          setContributorInput={search.actions.setContributorInput}
          setFilterContributor={search.actions.setFilterContributor}
          setContributorDropdownOpen={search.actions.setContributorDropdownOpen}
          setContributorActiveIndex={search.actions.setContributorActiveIndex}
          contributorDropdownOpen={search.state.contributorDropdownOpen}
          handleContributorInputKeyDown={search.actions.handleContributorInputKeyDown}
          applyContributorFilter={search.actions.applyContributorFilter}
          contributorLookupLoading={search.state.contributorLookupLoading}
          contributorSuggestions={search.state.contributorSuggestions}
          contributorActiveIndex={search.state.contributorActiveIndex}
          filterDate={search.state.filterDate}
          updateFilterDate={search.actions.updateFilterDate}
          filterType={search.state.filterType}
          updateFilterType={search.actions.updateFilterType}
          selectedAiModel={selectedAiModel}
          changeAiModel={changeAiModel}
          aiModelOptions={aiModelOptions}
          loading={search.state.loading}
          allResultsLength={search.derived.allResults.length}
          filteredResultsLength={search.derived.filteredResults.length}
          totalSize={search.state.totalSize}
          lastFetchAt={search.state.lastFetchAt}
          formatDate={formatDate}
        />

        <ResultsPanel
          view={search.state.view}
          scrollerRef={search.refs.scrollerRef}
          treeRoots={search.derived.treeRoots}
          isInitialSearching={search.state.isInitialSearching}
          searchText={search.state.searchText}
          collapsedNodes={search.state.collapsedNodes}
          toggleNode={search.actions.toggleNode}
          highlightResultRows={highlightResultRows}
          showTreeTooltips={showTreeTooltips}
          showTreeTooltip={(e, node) => search.actions.showTreeTooltip(e, node, showTreeTooltips)}
          moveTreeTooltip={(e, node) => search.actions.moveTreeTooltip(e, node, showTreeTooltips)}
          hideTreeTooltip={search.actions.hideTreeTooltip}
          enableSummaries={enableSummaries}
          aiItemLoadingId={ai.state.aiItemLoadingId}
          aiSummaryStatusById={ai.state.aiSummaryStatusById}
          openAiSummaryModal={ai.actions.openAiSummaryModal}
          filteredResults={search.derived.filteredResults}
          tableMinWidth={search.derived.tableMinWidth}
          tableColumns={search.derived.tableColumns}
          tableColWidths={search.state.tableColWidths}
          defaultTableColWidths={DEFAULT_TABLE_COL_WIDTHS}
          toggleTableSort={search.actions.toggleTableSort}
          tableSort={search.state.tableSort}
          startTableColumnResize={search.actions.startTableColumnResize}
          resetTableColumnWidth={search.actions.resetTableColumnWidth}
          tableResults={search.derived.tableResults}
          typeIcons={typeIcons}
          baseUrl={search.state.baseUrl}
          buildConfluenceUrl={buildConfluenceUrl}
          resolveConfluenceIconUrl={resolveConfluenceIconUrl}
          fallbackUserIcon={fallbackUserIcon}
          fallbackSpaceIcon={fallbackSpaceIcon}
          showTableTooltips={showTableTooltips}
          formatDate={formatDate}
          loading={search.state.loading}
          allResultsLength={search.derived.allResults.length}
          allLoaded={search.state.allLoaded}
        />
      </main>

      <button
        class={`scroll-top ${search.state.showScrollTop ? 'show' : ''}`}
        onClick={search.actions.scrollToTop}
        title="Back to top"
      >↑</button>

      <TreeTooltip
        treeTooltipData={search.state.treeTooltipData}
        treeTooltipRef={search.refs.treeTooltipRef}
        typeIcons={typeIcons}
        typeLabels={typeLabels}
        fallbackUserIcon={fallbackUserIcon}
        fallbackSpaceIcon={fallbackSpaceIcon}
      />

      <AiModal
        aiModalOpen={ai.state.aiModalOpen}
        closeAiModal={ai.actions.closeAiModal}
        aiModalRef={ai.refs.aiModalRef}
        aiModalWidth={ai.state.aiModalWidth}
        aiModalHeight={ai.state.aiModalHeight}
        startAiModalResize={ai.actions.startAiModalResize}
        resetAiModalWidth={ai.actions.resetAiModalWidth}
        startAiModalHeightResize={ai.actions.startAiModalHeightResize}
        resetAiModalHeight={ai.actions.resetAiModalHeight}
        aiActiveItem={ai.state.aiActiveItem}
        buildConfluenceUrl={buildConfluenceUrl}
        baseUrl={ai.state.aiBaseUrl}
        aiModalLoading={ai.state.aiModalLoading}
        aiModalLoadingTitle={ai.state.aiModalLoadingTitle}
        typeIcons={typeIcons}
        aiSpaceIconSrc={ai.state.aiSpaceIconSrc}
        fallbackSpaceIcon={fallbackSpaceIcon}
        aiContributorIconSrc={ai.state.aiContributorIconSrc}
        fallbackUserIcon={fallbackUserIcon}
        aiContributorName={ai.state.aiContributorName}
        selectedAiModel={selectedAiModel}
        aiModelOptions={aiModelOptions}
        changeAiModel={changeAiModel}
        isAiSummaryCollapsed={ai.state.isAiSummaryCollapsed}
        isAiChatCollapsed={ai.state.isAiChatCollapsed}
        aiLayoutRef={ai.refs.aiLayoutRef}
        aiSummaryPaneRatio={ai.state.aiSummaryPaneRatio}
        resummarizeActiveItem={ai.actions.resummarizeActiveItem}
        aiSummaryRefreshing={ai.state.aiSummaryRefreshing}
        aiAnswerLoading={ai.state.aiAnswerLoading}
        adjustAiSummaryFontSize={ai.actions.adjustAiSummaryFontSize}
        aiFontSizeStepPx={AI_FONT_SIZE_STEP_PX}
        aiSummaryFontSize={ai.state.aiSummaryFontSize}
        minAiSummaryFontSizePx={MIN_AI_SUMMARY_FONT_SIZE_PX}
        maxAiSummaryFontSizePx={MAX_AI_SUMMARY_FONT_SIZE_PX}
        toggleChatPane={ai.actions.toggleChatPane}
        toggleSummaryPane={ai.actions.toggleSummaryPane}
        aiSummaryDirection={ai.state.aiSummaryDirection}
        aiSummaryHtml={ai.state.aiSummaryHtml}
        startAiPaneResize={ai.actions.startAiPaneResize}
        resetAiSummaryPaneRatio={ai.actions.resetAiSummaryPaneRatio}
        clearAiConversation={ai.actions.clearAiConversation}
        adjustAiChatFontSize={ai.actions.adjustAiChatFontSize}
        aiChatFontSize={ai.state.aiChatFontSize}
        minAiChatFontSizePx={MIN_AI_CHAT_FONT_SIZE_PX}
        maxAiChatFontSizePx={MAX_AI_CHAT_FONT_SIZE_PX}
        aiThreadRef={ai.refs.aiThreadRef}
        aiConversation={ai.state.aiConversation}
        detectDirectionFromHtml={detectDirectionFromHtml}
        sanitizeHtmlFragment={sanitizeHtmlFragment}
        detectDirection={detectDirection}
        startAiQuestionInputResize={ai.actions.startAiQuestionInputResize}
        resetAiQuestionInputHeight={ai.actions.resetAiQuestionInputHeight}
        aiQuestionInputRef={ai.refs.aiQuestionInputRef}
        aiQuestion={ai.state.aiQuestion}
        setAiQuestion={ai.actions.setAiQuestion}
        submitAiQuestion={ai.actions.submitAiQuestion}
        aiQuestionInputHeight={ai.state.aiQuestionInputHeight}
      />

      <SavedSearchModal
        savedModalOpen={saved.state.savedModalOpen}
        onClose={() => saved.actions.setSavedModalOpen(false)}
        savedSearchQuery={saved.state.savedSearchQuery}
        setSavedSearchQuery={saved.actions.setSavedSearchQuery}
        removeAllSavedSearches={saved.actions.removeAllSavedSearches}
        savedSearchesFiltered={saved.state.savedSearchesFiltered}
        savedSearchVisualsById={saved.state.savedSearchVisualsById}
        fallbackSpaceIcon={fallbackSpaceIcon}
        fallbackUserIcon={fallbackUserIcon}
        formatDate={formatDate}
        runSavedSearch={saved.actions.runSavedSearch}
        renameSavedSearch={saved.actions.renameSavedSearch}
        removeSavedSearch={saved.actions.removeSavedSearch}
      />

      <SaveNameDialog
        open={saved.state.saveNameDialog.open}
        dialog={saved.state.saveNameDialog}
        inputRef={saved.refs.saveNameDialogInputRef}
        onClose={saved.actions.closeSaveNameDialog}
        onChangeValue={(value) => saved.actions.setSaveNameDialog((prev) => ({ ...prev, value }))}
        onSubmit={saved.actions.handleSaveNameDialogSubmit}
      />

      <ConfirmDialog
        open={confirmDialog.open}
        dialog={confirmDialog}
        onClose={closeConfirmDialog}
      />

      <NoticeDialog
        open={noticeDialog.open}
        dialog={noticeDialog}
        onClose={closeNoticeDialog}
      />
    </div>
  );
}
