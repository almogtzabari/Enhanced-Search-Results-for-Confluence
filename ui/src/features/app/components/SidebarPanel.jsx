export function SidebarPanel({
  view,
  handleTreeViewClick,
  setView,
  saveCurrentSearch,
  openSavedSearches,
  filterText,
  setFilterText,
  spaceBoxRef,
  filterSpace,
  selectedSpaceIcon,
  fallbackSpaceIcon,
  spaceInput,
  setSpaceInput,
  setFilterSpace,
  setSpaceDropdownOpen,
  setSpaceActiveIndex,
  spaceDropdownOpen,
  handleSpaceInputKeyDown,
  applySpaceFilter,
  spaceLookupLoading,
  spaceSuggestions,
  spaceActiveIndex,
  contributorBoxRef,
  filterContributor,
  selectedContributorIcon,
  fallbackUserIcon,
  contributorInput,
  setContributorInput,
  setFilterContributor,
  setContributorDropdownOpen,
  setContributorActiveIndex,
  contributorDropdownOpen,
  handleContributorInputKeyDown,
  applyContributorFilter,
  contributorLookupLoading,
  contributorSuggestions,
  contributorActiveIndex,
  filterDate,
  updateFilterDate,
  filterType,
  updateFilterType,
  selectedAiModel,
  changeAiModel,
  aiModelOptions,
  loading,
  allResultsLength,
  filteredResultsLength,
  totalSize,
  lastFetchAt,
  formatDate,
}) {
  return (
    <aside class="panel sidebar">
      <section class="sidebar-block">
        <h3>Views</h3>
        <div class="btn-row">
          <button class={`btn view-btn ${view === 'tree' ? 'active' : ''}`} onClick={handleTreeViewClick}>
            <img class="view-btn-icon" src="../../assets/icons/tree-view-button.png" alt="" />
            <span>Tree</span>
          </button>
          <button class={`btn view-btn ${view === 'table' ? 'active' : ''}`} onClick={() => setView('table')}>
            <img class="view-btn-icon" src="../../assets/icons/table-view-button.png" alt="" />
            <span>Table</span>
          </button>
        </div>
      </section>

      <section class="sidebar-block">
        <h3>Saved Searches</h3>
        <div class="btn-row">
          <button class="btn view-btn" onClick={saveCurrentSearch}>
            <img class="view-btn-icon" src="../../assets/icons/save-search-button.png" alt="" />
            <span>Save</span>
          </button>
          <button class="btn view-btn" onClick={openSavedSearches}>
            <img class="view-btn-icon" src="../../assets/icons/load-search-button.png" alt="" />
            <span>Load</span>
          </button>
        </div>
      </section>

      <section class="sidebar-block">
        <h3>Filters</h3>

        <div class="field with-icon">
          <span class="field-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.2-4.2M10.8 18a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
          </span>
          <input value={filterText} onInput={(e) => setFilterText(e.currentTarget.value)} placeholder="Filter by text" />
        </div>

        <div class="field combo-field" ref={spaceBoxRef}>
          <div class="combo-input-wrap with-icon">
            {filterSpace ? (
              <img
                class="field-icon selected-filter-icon"
                src={selectedSpaceIcon || fallbackSpaceIcon}
                alt=""
                onError={(e) => { e.currentTarget.src = fallbackSpaceIcon; }}
              />
            ) : (
              <span class="field-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5a2 2 0 0 1 2-2H11l1.5 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-10Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /></svg>
              </span>
            )}
            <input
              value={spaceInput}
              onInput={(e) => {
                setSpaceInput(e.currentTarget.value);
                setFilterSpace('');
                setSpaceDropdownOpen(true);
                setSpaceActiveIndex(-1);
              }}
              onFocus={() => setSpaceDropdownOpen(true)}
              onKeyDown={handleSpaceInputKeyDown}
              placeholder="Filter spaces (type to search)"
            />
            {filterSpace && (
              <button
                class="combo-clear-selected"
                onClick={() => {
                  applySpaceFilter(null);
                  setSpaceInput('');
                }}
                title="Clear selected space"
              >
                ×
              </button>
            )}
            {spaceLookupLoading && <span class="combo-status">Searching...</span>}
          </div>
          {spaceDropdownOpen && (
            <div class="combo-options space-options">
              {spaceSuggestions.map((space, idx) => (
                <button
                  key={space.key}
                  class={`combo-option ${spaceActiveIndex === idx ? 'highlighted' : ''}`}
                  onMouseEnter={() => setSpaceActiveIndex(idx)}
                  onClick={() => applySpaceFilter(space)}
                >
                  <img src={space.iconUrl} alt="" />
                  <span>{space.name}</span>
                </button>
              ))}
              {spaceSuggestions.length === 0 && <div class="combo-empty">No spaces found.</div>}
            </div>
          )}
        </div>

        <div class="field combo-field" ref={contributorBoxRef}>
          <div class="combo-input-wrap with-icon">
            {filterContributor ? (
              <img
                class="field-icon selected-filter-icon"
                src={selectedContributorIcon || fallbackUserIcon}
                alt=""
                onError={(e) => { e.currentTarget.src = fallbackUserIcon; }}
              />
            ) : (
              <span class="field-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.4" fill="none" stroke="currentColor" stroke-width="1.7" /><path d="M5 19a7 7 0 0 1 14 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
              </span>
            )}
            <input
              value={contributorInput}
              onInput={(e) => {
                setContributorInput(e.currentTarget.value);
                setFilterContributor('');
                setContributorDropdownOpen(true);
                setContributorActiveIndex(-1);
              }}
              onFocus={() => setContributorDropdownOpen(true)}
              onKeyDown={handleContributorInputKeyDown}
              placeholder="Filter contributors (type to search)"
            />
            {filterContributor && (
              <button
                class="combo-clear-selected"
                onClick={() => {
                  applyContributorFilter(null);
                  setContributorInput('');
                }}
                title="Clear selected contributor"
              >
                ×
              </button>
            )}
            {contributorLookupLoading && <span class="combo-status">Searching...</span>}
          </div>
          {contributorDropdownOpen && (
            <div class="combo-options contributor-options">
              {contributorSuggestions.map((contributor, idx) => (
                <button
                  key={contributor.key}
                  class={`combo-option ${contributorActiveIndex === idx ? 'highlighted' : ''}`}
                  onMouseEnter={() => setContributorActiveIndex(idx)}
                  onClick={() => applyContributorFilter(contributor)}
                >
                  <img src={contributor.avatarUrl} alt="" />
                  <span>{contributor.name}</span>
                </button>
              ))}
              {contributorSuggestions.length === 0 && <div class="combo-empty">No contributors found.</div>}
            </div>
          )}
        </div>

        <div class="field with-icon">
          <span class="field-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.7" /><path d="M8 3.5v3M16 3.5v3M4 9.3h16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
          </span>
          <select value={filterDate} onChange={(e) => updateFilterDate(e.currentTarget.value)}>
            <option value="any">Any time</option>
            <option value="1d">Past day</option>
            <option value="1w">Past week</option>
            <option value="1m">Past month</option>
            <option value="1y">Past year</option>
          </select>
        </div>

        <div class="field with-icon">
          <span class="field-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7.5h15M4.5 12h15M4.5 16.5h15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /><circle cx="9" cy="7.5" r="1.3" fill="currentColor" /><circle cx="14" cy="12" r="1.3" fill="currentColor" /><circle cx="11" cy="16.5" r="1.3" fill="currentColor" /></svg>
          </span>
          <select value={filterType} onChange={(e) => updateFilterType(e.currentTarget.value)}>
            <option value="">📚 All Types</option>
            <option value="page">📄 Page</option>
            <option value="blogpost">📰 Blog post</option>
            <option value="attachment">📎 Attachment</option>
            <option value="comment">💬 Comment</option>
          </select>
        </div>
      </section>

      <section class="sidebar-block">
        <h3>AI</h3>
        <div class="field">
          <select value={selectedAiModel} onChange={(e) => changeAiModel(e.currentTarget.value)}>
            {aiModelOptions.map((modelOpt) => (
              <option key={modelOpt.value} value={modelOpt.value}>{modelOpt.label}</option>
            ))}
          </select>
        </div>
      </section>

      <section class="sidebar-block">
        <h3>Stats</h3>
        <div class="stats-list">
          <div class="stats-row">
            <span class="stats-label">Showing</span>
            <span class="stats-value">
              {loading && allResultsLength === 0
                ? 'Loading...'
                : `${filteredResultsLength} (${allResultsLength}/${totalSize ?? '…'} loaded)`}
            </span>
          </div>
          <div class="stats-row">
            <span class="stats-label">Last fetch time</span>
            <span class="stats-value">
              {lastFetchAt ? formatDate(lastFetchAt) : 'Not fetched yet'}
            </span>
          </div>
        </div>
      </section>
    </aside>
  );
}
