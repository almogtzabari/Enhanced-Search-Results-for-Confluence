export function TopBarSearch({
  domainName,
  isDarkMode,
  toggleDarkMode,
  openOptions,
  searchInputAttention,
  searchInputRef,
  searchInput,
  setSearchInput,
  runSearch,
}) {
  return (
    <header class="topbar">
      <div class="topbar-inner">
        <div class="topbar-head">
          <div class="brand-wrap">
            <img class="brand-logo" src="../../assets/logo.png" alt="Enhanced Search Results" />
            <h1>{domainName}</h1>
          </div>
          <div class="topbar-actions">
            <button
              class="icon-btn topbar-icon-btn"
              onClick={toggleDarkMode}
              title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDarkMode ? (
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
            <button class="icon-btn topbar-icon-btn settings-btn" onClick={openOptions} title="Settings">
              <svg class="settings-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M19.14 12.94a7.48 7.48 0 0 0 .05-.94 7.48 7.48 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.63l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.57.22-1.11.53-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.7 8.85a.5.5 0 0 0 .12.63l2.03 1.58a7.48 7.48 0 0 0-.05.94 7.48 7.48 0 0 0 .05.94L2.82 14.52a.5.5 0 0 0-.12.63l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.41 1.05.72 1.62.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.57-.22 1.11-.53 1.62-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.63l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
        </div>

        <div class={`search-row ${searchInputAttention ? 'search-row-attention' : ''}`.trim()}>
          <div class="search-input-wrap">
            <input
              ref={searchInputRef}
              class="search-input"
              value={searchInput}
              onInput={(e) => setSearchInput(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
              dir="auto"
              lang="und"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              placeholder="Enter new search query..."
            />
            {searchInput && (
              <button class="clear-btn" onClick={() => setSearchInput('')} title="Clear">&times;</button>
            )}
          </div>
          <button class="search-btn" onClick={runSearch}>Search</button>
        </div>
      </div>
    </header>
  );
}
