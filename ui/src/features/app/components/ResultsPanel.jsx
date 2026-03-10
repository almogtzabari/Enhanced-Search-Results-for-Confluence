import { TreeNode } from './TreeNode.jsx';

export function ResultsPanel({
  view,
  scrollerRef,
  treeRoots,
  isInitialSearching,
  searchText,
  collapsedNodes,
  toggleNode,
  highlightResultRows,
  showTreeTooltips,
  showTreeTooltip,
  moveTreeTooltip,
  hideTreeTooltip,
  enableSummaries,
  aiItemLoadingId,
  aiSummaryStatusById,
  openAiSummaryModal,
  filteredResults,
  tableMinWidth,
  tableColumns,
  tableColWidths,
  defaultTableColWidths,
  toggleTableSort,
  tableSort,
  startTableColumnResize,
  resetTableColumnWidth,
  tableResults,
  typeIcons,
  baseUrl,
  buildConfluenceUrl,
  resolveConfluenceIconUrl,
  fallbackUserIcon,
  fallbackSpaceIcon,
  showTableTooltips,
  formatDate,
  loading,
  allResultsLength,
  allLoaded,
}) {
  return (
    <section class="panel results">
      <div class={`results-scroll ${view === 'table' ? 'table-mode' : ''}`} ref={scrollerRef}>
        {view === 'tree' ? (
          treeRoots.length === 0 ? (
            isInitialSearching ? (
              <div class="searching-state">
                <div class="searching-title">Searching Confluence...</div>
                <div class="typing-dots">
                  <span class="dot" />
                  <span class="dot" />
                  <span class="dot" />
                </div>
              </div>
            ) : (
              <div class="empty">{searchText ? 'No results to display.' : 'Enter a search query to begin.'}</div>
            )
          ) : (
            <ul class="tree-list root">
              {treeRoots.map((node) => (
                <TreeNode
                  key={node.id}
                  node={node}
                  collapsed={collapsedNodes}
                  onToggle={toggleNode}
                  highlightResultRows={highlightResultRows}
                  showTreeTooltips={showTreeTooltips}
                  onShowTooltip={showTreeTooltip}
                  onMoveTooltip={moveTreeTooltip}
                  onHideTooltip={hideTreeTooltip}
                  canSummarize={enableSummaries}
                  aiLoadingItemId={aiItemLoadingId}
                  aiSummaryStatusById={aiSummaryStatusById}
                  onSummarize={openAiSummaryModal}
                />
              ))}
            </ul>
          )
        ) : (
          filteredResults.length === 0 ? (
            isInitialSearching ? (
              <div class="searching-state">
                <div class="searching-title">Searching Confluence...</div>
                <div class="typing-dots">
                  <span class="dot" />
                  <span class="dot" />
                  <span class="dot" />
                </div>
              </div>
            ) : (
              <div class="empty">{searchText ? 'No results to display.' : 'Enter a search query to begin.'}</div>
            )
          ) : (
            <table class="results-table" style={{ minWidth: `${tableMinWidth}px` }}>
              <colgroup>
                {tableColumns.map((col) => (
                  <col key={`col-${col.key}`} style={{ width: `${tableColWidths[col.key] || defaultTableColWidths[col.key] || 120}px` }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {tableColumns.map((column) => (
                    <th key={`th-${column.key}`} class={`table-head-cell ${column.sortable ? 'sortable' : ''}`.trim()}>
                      {column.sortable ? (
                        <button
                          type="button"
                          class="table-sort-btn"
                          onClick={() => toggleTableSort(column.key)}
                          title={
                            tableSort.key === column.key
                              ? (tableSort.direction === 'asc'
                                ? `Sorted ascending by ${column.label}. Click for descending.`
                                : `Sorted descending by ${column.label}. Click to clear sorting.`)
                              : `Sort by ${column.label}`
                          }
                        >
                          <span>{column.label}</span>
                          <span class="table-sort-indicator" aria-hidden="true">
                            {tableSort.key === column.key
                              ? (tableSort.direction === 'asc' ? '↑' : '↓')
                              : '↕'}
                          </span>
                        </button>
                      ) : (
                        <span class="table-head-label">{column.label}</span>
                      )}
                      <span
                        class="th-resizer-v2"
                        onMouseDown={(e) => startTableColumnResize(e, column.key)}
                        onClick={(e) => e.stopPropagation()}
                        onDblClick={(e) => {
                          e.stopPropagation();
                          resetTableColumnWidth(column.key);
                        }}
                        title="Drag to resize (double-click to reset)"
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableResults.map((item) => {
                  const aiStatus = aiItemLoadingId === item.id ? 'loading' : (aiSummaryStatusById[item.id] || 'idle');
                  const aiLabel = aiStatus === 'loading'
                    ? 'Thinking...'
                    : aiStatus === 'ready'
                      ? 'Open'
                      : 'Summarize';
                  const creator = item.history?.createdBy;
                  const creatorKey = creator?.username || creator?.userKey || creator?.accountId || '';
                  const creatorName = creator?.displayName || 'Unknown';
                  const creatorUrl = creatorKey ? `${baseUrl}/display/~${creatorKey}` : '#';
                  const creatorAvatarUrl = resolveConfluenceIconUrl(baseUrl, creator?.profilePicture?.path || '', fallbackUserIcon);
                  const spaceName = item.space?.name || '';
                  const spaceUrl = buildConfluenceUrl(baseUrl, item.space?._links?.webui);
                  const spaceIconUrl = resolveConfluenceIconUrl(baseUrl, item.space?.icon?.path || '', fallbackSpaceIcon);

                  return (
                    <tr key={item.id}>
                      <td>{typeIcons[item.type] || '📘'}</td>
                      <td class="ellipsis-cell">
                        <a href={buildConfluenceUrl(baseUrl, item._links?.webui)} target="_blank" rel="noreferrer">
                          {item.title || '(Untitled)'}
                        </a>
                      </td>
                      <td class="ellipsis-cell">
                        {spaceName && (
                          <span class={`table-entity-cell ${showTableTooltips ? 'ai-chip-hoverable' : ''}`} tabIndex={showTableTooltips ? 0 : undefined}>
                            <img
                              class="table-entity-avatar table-entity-avatar-space"
                              src={spaceIconUrl}
                              alt=""
                              onError={(e) => { e.currentTarget.src = fallbackSpaceIcon; }}
                            />
                            <a class="table-entity-name" href={spaceUrl} target="_blank" rel="noreferrer">
                              {spaceName}
                            </a>
                            {showTableTooltips && (
                              <span class="ai-chip-popover table-entity-popover" role="tooltip" aria-hidden="true">
                                <img
                                  class="ai-chip-popover-avatar"
                                  src={spaceIconUrl}
                                  alt=""
                                  onError={(e) => { e.currentTarget.src = fallbackSpaceIcon; }}
                                />
                                <span class="ai-chip-popover-meta">
                                  <span class="ai-chip-popover-label">Space</span>
                                  <span class="ai-chip-popover-name">{spaceName}</span>
                                </span>
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                      <td class="ellipsis-cell">
                        {creatorName !== 'Unknown' ? (
                          <span class={`table-entity-cell ${showTableTooltips ? 'ai-chip-hoverable' : ''}`} tabIndex={showTableTooltips ? 0 : undefined}>
                            <img
                              class="table-entity-avatar"
                              src={creatorAvatarUrl}
                              alt=""
                              onError={(e) => { e.currentTarget.src = fallbackUserIcon; }}
                            />
                            <a class="table-entity-name" href={creatorUrl} target="_blank" rel="noreferrer">
                              {creatorName}
                            </a>
                            {showTableTooltips && (
                              <span class="ai-chip-popover table-entity-popover" role="tooltip" aria-hidden="true">
                                <img
                                  class="ai-chip-popover-avatar"
                                  src={creatorAvatarUrl}
                                  alt=""
                                  onError={(e) => { e.currentTarget.src = fallbackUserIcon; }}
                                />
                                <span class="ai-chip-popover-meta">
                                  <span class="ai-chip-popover-label">Contributor</span>
                                  <span class="ai-chip-popover-name">{creatorName}</span>
                                </span>
                              </span>
                            )}
                          </span>
                        ) : (
                          'Unknown'
                        )}
                      </td>
                      <td>{formatDate(item.history?.createdDate)}</td>
                      <td>{formatDate(item.version?.when)}</td>
                      {enableSummaries && (
                        <td>
                          <button
                            class="mini-ai-btn"
                            onClick={() => openAiSummaryModal(item)}
                            disabled={aiStatus === 'loading'}
                            title="AI Summary"
                            data-status={aiStatus}
                            aria-busy={aiStatus === 'loading' ? 'true' : 'false'}
                          >
                            <span class="mini-ai-btn__icon" aria-hidden="true" />
                            <span class="mini-ai-btn__label">{aiLabel}</span>
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}

        {loading && allResultsLength > 0 && (
          <div class="loading-line loading-line-animated" role="status" aria-live="polite">
            <div class="loading-line-head">
              <span>Loading more results</span>
              <span class="typing-dots" aria-hidden="true">
                <span class="dot" />
                <span class="dot" />
                <span class="dot" />
              </span>
            </div>
          </div>
        )}
        {allLoaded && allResultsLength > 0 && <div class="end-line">All results loaded.</div>}
      </div>
    </section>
  );
}
