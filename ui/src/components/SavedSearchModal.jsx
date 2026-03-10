export function SavedSearchModal({
  savedModalOpen,
  onClose,
  savedSearchQuery,
  setSavedSearchQuery,
  removeAllSavedSearches,
  savedSearchesFiltered,
  savedSearchVisualsById,
  fallbackSpaceIcon,
  fallbackUserIcon,
  formatDate,
  runSavedSearch,
  renameSavedSearch,
  removeSavedSearch,
}) {
  if (!savedModalOpen) return null;

  return (
    <div class="saved-modal-overlay" onClick={onClose}>
      <div class="saved-modal" onClick={(e) => e.stopPropagation()}>
        <div class="saved-modal-head">
          <h2>Saved Searches</h2>
          <button class="icon-btn" onClick={onClose} title="Close">×</button>
        </div>

        <div class="saved-modal-toolbar">
          <input
            value={savedSearchQuery}
            onInput={(e) => setSavedSearchQuery(e.currentTarget.value)}
            placeholder="Filter saved searches..."
          />
          <button class="btn danger" onClick={removeAllSavedSearches}>Clear All</button>
        </div>

        <div class="saved-modal-list">
          {savedSearchesFiltered.length === 0 ? (
            <div class="empty">No saved searches.</div>
          ) : (
            savedSearchesFiltered.map((entry) => (
              <article class="saved-entry" key={entry.id}>
                {(() => {
                  const visuals = savedSearchVisualsById[entry.id] || {};
                  const spaceIconSrc = visuals.spaceIconUrl || fallbackSpaceIcon;
                  const contributorIconSrc = visuals.contributorIconUrl || fallbackUserIcon;
                  return (
                    <>
                      <div class="saved-entry-main">
                        <aside class="saved-entry-left">
                          <div class="saved-entry-icon-row">
                            <img
                              class="saved-entry-icon-large"
                              src={spaceIconSrc}
                              alt=""
                              onError={(e) => { e.currentTarget.src = fallbackSpaceIcon; }}
                            />
                            <div>
                              <div class="saved-entry-left-label">Space</div>
                              <div class="saved-entry-left-value">{entry.filters?.space?.label || entry.filters?.space?.key || 'Any'}</div>
                            </div>
                          </div>
                          <div class="saved-entry-icon-row">
                            <img
                              class="saved-entry-icon-large"
                              src={contributorIconSrc}
                              alt=""
                              onError={(e) => { e.currentTarget.src = fallbackUserIcon; }}
                            />
                            <div>
                              <div class="saved-entry-left-label">Contributor</div>
                              <div class="saved-entry-left-value">{entry.filters?.contributor?.label || entry.filters?.contributor?.key || 'Any'}</div>
                            </div>
                          </div>
                        </aside>
                        <section class="saved-entry-right">
                          <div class="saved-entry-title">{entry.name}</div>
                          <div class="saved-entry-grid">
                            <div class="saved-entry-meta"><strong>Search:</strong> {entry.searchText || 'N/A'}</div>
                            <div class="saved-entry-meta"><strong>Text:</strong> {entry.filters?.text?.label || entry.filters?.text?.key || 'Any'}</div>
                            <div class="saved-entry-meta"><strong>Date Filter:</strong> {entry.filters?.date || 'any'}</div>
                            <div class="saved-entry-meta"><strong>Type:</strong> {entry.filters?.type || 'Any'}</div>
                            <div class="saved-entry-meta"><strong>Saved:</strong> {formatDate(entry.createdAt)}</div>
                            <div class="saved-entry-meta"><strong>Modified:</strong> {formatDate(entry.updatedAt || entry.createdAt)}</div>
                          </div>
                        </section>
                      </div>
                      <div class="saved-entry-actions">
                        <button class="btn secondary" onClick={() => runSavedSearch(entry)}>Run</button>
                        <button class="btn secondary" onClick={() => renameSavedSearch(entry)}>Rename</button>
                        <button class="btn danger" onClick={() => removeSavedSearch(entry)}>Delete</button>
                      </div>
                    </>
                  );
                })()}
              </article>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
