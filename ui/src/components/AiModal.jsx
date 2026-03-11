import { useEffect, useRef, useState } from 'preact/hooks';
import { CustomSelect } from './CustomSelect.jsx';

const MIN_AI_TABLE_COL_WIDTH = 86;
const AI_TABLE_SORT_NONE = 'none';
const AI_TABLE_SORT_ASC = 'asc';
const AI_TABLE_SORT_DESC = 'desc';

function getTableHeaderRow(table) {
  if (table.tHead?.rows?.length) {
    const headRows = Array.from(table.tHead.rows);
    const rowWithHeaders = headRows.find((row) => Array.from(row.cells).some((cell) => cell.tagName === 'TH'));
    if (rowWithHeaders) return rowWithHeaders;
    return headRows[headRows.length - 1] || null;
  }

  if (!table.rows?.length) return null;
  return table.rows[0];
}

function getTableHeaderCells(table) {
  const headerRow = getTableHeaderRow(table);
  return headerRow ? Array.from(headerRow.cells || []) : [];
}

function ensureColgroup(table, colCount) {
  let colgroup = Array.from(table.children).find((child) => child.tagName === 'COLGROUP');
  if (!colgroup) {
    colgroup = document.createElement('colgroup');
    table.insertBefore(colgroup, table.firstChild);
  }
  while (colgroup.children.length < colCount) {
    colgroup.appendChild(document.createElement('col'));
  }
  while (colgroup.children.length > colCount) {
    colgroup.removeChild(colgroup.lastChild);
  }
  return colgroup;
}

function getCellWidthPx(cell) {
  return Math.max(MIN_AI_TABLE_COL_WIDTH, Math.round(cell.getBoundingClientRect().width || cell.offsetWidth || 120));
}

function getTableDataRows(table, headerRow) {
  if (table.tBodies?.length) {
    const body = table.tBodies[0];
    return { container: body, rows: Array.from(body.rows || []) };
  }
  return {
    container: table,
    rows: Array.from(table.rows || []).filter((row) => row !== headerRow),
  };
}

function getCellSortableText(cell) {
  return String(cell?.textContent || '').replace(/\s+/g, ' ').trim();
}

function parseSortableNumber(value) {
  const cleaned = String(value || '')
    .replace(/[%,$\s]/g, '')
    .replace(/,/g, '')
    .trim();
  if (!cleaned || !/^[-+]?(?:\d+|\d*\.\d+)$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSortableDate(value) {
  const text = String(value || '').trim();
  if (!text || !/[A-Za-z]|[/:\-.]/.test(text)) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareSortableValues(aText, bText) {
  if (!aText && !bText) return 0;
  if (!aText) return 1;
  if (!bText) return -1;

  const aNum = parseSortableNumber(aText);
  const bNum = parseSortableNumber(bText);
  if (aNum !== null && bNum !== null) return aNum - bNum;

  const aDate = parseSortableDate(aText);
  const bDate = parseSortableDate(bText);
  if (aDate !== null && bDate !== null) return aDate - bDate;

  return aText.localeCompare(bText, undefined, { numeric: true, sensitivity: 'base' });
}

function updateTableSortIndicators(headerCells, activeColIndex, direction) {
  headerCells.forEach((cell, colIndex) => {
    const indicator = cell.querySelector('.ai-table-sort-indicator');
    if (!indicator) return;
    if (colIndex === activeColIndex && direction !== AI_TABLE_SORT_NONE) {
      indicator.textContent = direction === AI_TABLE_SORT_ASC ? '↑' : '↓';
      cell.dataset.sort = direction;
    } else {
      indicator.textContent = '↕';
      delete cell.dataset.sort;
    }
  });
}

function applyTableSort(table, headerCells, headerRow, colIndex, direction) {
  const { container, rows } = getTableDataRows(table, headerRow);
  if (rows.length < 2) return;

  rows.forEach((row, rowIndex) => {
    if (row.dataset.aiSortOriginalIndex === undefined) {
      row.dataset.aiSortOriginalIndex = String(rowIndex);
    }
  });

  const sortedRows = [...rows].sort((a, b) => {
    if (direction === AI_TABLE_SORT_NONE) {
      return Number(a.dataset.aiSortOriginalIndex || 0) - Number(b.dataset.aiSortOriginalIndex || 0);
    }

    const aText = getCellSortableText(a.cells?.[colIndex]);
    const bText = getCellSortableText(b.cells?.[colIndex]);
    const cmp = compareSortableValues(aText, bText);
    if (cmp === 0) {
      return Number(a.dataset.aiSortOriginalIndex || 0) - Number(b.dataset.aiSortOriginalIndex || 0);
    }
    return direction === AI_TABLE_SORT_ASC ? cmp : -cmp;
  });

  sortedRows.forEach((row) => container.appendChild(row));

  if (direction === AI_TABLE_SORT_NONE) {
    delete table.dataset.aiSortColumnIndex;
    delete table.dataset.aiSortDirection;
  } else {
    table.dataset.aiSortColumnIndex = String(colIndex);
    table.dataset.aiSortDirection = direction;
  }
  updateTableSortIndicators(headerCells, colIndex, direction);
}

function attachTableSorting(table, headerCells, headerRow) {
  const { rows } = getTableDataRows(table, headerRow);
  if (rows.length < 2) return;

  headerCells.forEach((cell, colIndex) => {
    if (cell.querySelector('.ai-table-sort-indicator')) return;

    cell.classList.add('ai-table-sortable');
    cell.setAttribute('tabindex', '0');
    cell.setAttribute('role', 'button');
    cell.title = 'Click to sort';

    const indicator = document.createElement('span');
    indicator.className = 'ai-table-sort-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    indicator.textContent = '↕';
    cell.appendChild(indicator);

    const triggerSort = () => {
      const activeIndex = Number.parseInt(table.dataset.aiSortColumnIndex || '', 10);
      const activeDirection = table.dataset.aiSortDirection || AI_TABLE_SORT_NONE;
      let nextDirection = AI_TABLE_SORT_ASC;

      if (activeIndex === colIndex) {
        if (activeDirection === AI_TABLE_SORT_ASC) nextDirection = AI_TABLE_SORT_DESC;
        else if (activeDirection === AI_TABLE_SORT_DESC) nextDirection = AI_TABLE_SORT_NONE;
      }

      applyTableSort(table, headerCells, headerRow, colIndex, nextDirection);
    };

    cell.addEventListener('click', (event) => {
      const target = event.target;
      if (target instanceof Element) {
        if (target.closest('.ai-table-col-resizer')) return;
        if (target.closest('a, button, input, select, textarea')) return;
      }
      triggerSort();
    });

    cell.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      triggerSort();
    });
  });
}

function enhanceAiTables(root) {
  if (!root) return;
  const tables = root.querySelectorAll('table');
  tables.forEach((table) => {
    if (table.dataset.aiResizableReady === 'true') return;

    if (!table.parentElement?.classList.contains('ai-table-scroll-wrap')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'ai-table-scroll-wrap';
      table.parentElement?.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    }

    const headerRow = getTableHeaderRow(table);
    if (!headerRow) return;
    const headerCells = getTableHeaderCells(table);
    if (headerCells.length < 2) return;

    const colgroup = ensureColgroup(table, headerCells.length);
    const cols = Array.from(colgroup.children);
    const initialWidths = headerCells.map(getCellWidthPx);
    const totalWidth = initialWidths.reduce((sum, width) => sum + width, 0);
    const minTableWidth = table.parentElement?.clientWidth || 0;

    table.classList.add('ai-resizable-table');
    table.style.width = `${Math.max(minTableWidth, totalWidth)}px`;

    cols.forEach((col, colIndex) => {
      col.style.width = `${initialWidths[colIndex]}px`;
    });

    headerCells.forEach((cell, colIndex) => {
      if (cell.querySelector('.ai-table-col-resizer')) return;
      cell.classList.add('ai-table-head-cell');

      const handle = document.createElement('span');
      handle.className = 'ai-table-col-resizer';
      handle.title = 'Drag to resize column';
      handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-orientation', 'vertical');

      handle.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();

        const startX = event.clientX;
        const isRtl = getComputedStyle(table).direction === 'rtl';
        const startColWidth = parseFloat(cols[colIndex]?.style.width) || getCellWidthPx(cell);
        const startTableWidth = table.getBoundingClientRect().width;
        const tableMinWidth = table.parentElement?.clientWidth || 0;
        const previousCursor = document.body.style.cursor;
        const previousUserSelect = document.body.style.userSelect;

        const onMove = (moveEvent) => {
          const rawDelta = moveEvent.clientX - startX;
          const delta = isRtl ? -rawDelta : rawDelta;
          const nextColWidth = Math.max(MIN_AI_TABLE_COL_WIDTH, startColWidth + delta);
          const appliedDelta = nextColWidth - startColWidth;
          if (cols[colIndex]) cols[colIndex].style.width = `${nextColWidth}px`;
          table.style.width = `${Math.max(tableMinWidth, Math.round(startTableWidth + appliedDelta))}px`;
        };

        const onStop = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onStop);
          document.body.style.cursor = previousCursor;
          document.body.style.userSelect = previousUserSelect;
        };

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onStop);
      });

      handle.addEventListener('click', (event) => {
        event.stopPropagation();
      });

      cell.appendChild(handle);
    });

    attachTableSorting(table, headerCells, headerRow);

    table.dataset.aiResizableReady = 'true';
  });
}

function resolveModalItemWebUi(baseUrl, item) {
  const explicitWebUi = String(item?._links?.webui || '').trim();
  if (explicitWebUi) return explicitWebUi;

  const contentId = String(item?.id || '').trim();
  if (!contentId) return '';

  try {
    const parsedBase = new URL(String(baseUrl || window.location.origin), window.location.origin);
    const contextPath = parsedBase.pathname.replace(/\/+$/, '');
    if (contextPath && contextPath !== '/') return `${contextPath}/pages/${encodeURIComponent(contentId)}`;
  } catch {
    // Fall back to root-relative page path.
  }

  return `/pages/${encodeURIComponent(contentId)}`;
}

export function AiModal({
  aiModalOpen,
  closeAiModal,
  aiModalRef,
  aiModalWidth,
  aiModalHeight,
  startAiModalResize,
  resetAiModalWidth,
  startAiModalHeightResize,
  resetAiModalHeight,
  aiActiveItem,
  buildConfluenceUrl,
  baseUrl,
  aiModalLoading,
  aiModalLoadingTitle,
  typeIcons,
  aiSpaceIconSrc,
  fallbackSpaceIcon,
  aiContributorIconSrc,
  fallbackUserIcon,
  aiContributorName,
  selectedAiModel,
  aiModelOptions,
  changeAiModel,
  isAiSummaryCollapsed,
  isAiChatCollapsed,
  aiLayoutRef,
  aiSummaryPaneRatio,
  resummarizeActiveItem,
  aiSummaryRefreshing,
  aiAnswerLoading,
  adjustAiSummaryFontSize,
  aiFontSizeStepPx,
  aiSummaryFontSize,
  minAiSummaryFontSizePx,
  maxAiSummaryFontSizePx,
  toggleChatPane,
  toggleSummaryPane,
  aiSummaryDirection,
  aiSummaryHtml,
  startAiPaneResize,
  resetAiSummaryPaneRatio,
  clearAiConversation,
  adjustAiChatFontSize,
  aiChatFontSize,
  minAiChatFontSizePx,
  maxAiChatFontSizePx,
  aiThreadRef,
  aiConversation,
  detectDirectionFromHtml,
  sanitizeHtmlFragment,
  detectDirection,
  startAiQuestionInputResize,
  resetAiQuestionInputHeight,
  aiQuestionInputRef,
  aiQuestion,
  setAiQuestion,
  submitAiQuestion,
  aiQuestionInputHeight,
}) {
  const aiSummaryRef = useRef(null);
  const [layoutMotionClass, setLayoutMotionClass] = useState('');
  const collapseStateRef = useRef({
    summary: isAiSummaryCollapsed,
    chat: isAiChatCollapsed,
  });
  const motionTimerRef = useRef(null);
  const aiItemWebUi = resolveModalItemWebUi(baseUrl, aiActiveItem);
  const aiItemLink = aiItemWebUi ? buildConfluenceUrl(baseUrl, aiItemWebUi) : '#';

  useEffect(() => {
    if (!aiModalOpen || aiModalLoading) return;
    enhanceAiTables(aiSummaryRef.current);
    enhanceAiTables(aiThreadRef?.current);
  }, [aiModalOpen, aiModalLoading, aiSummaryHtml, aiConversation]);

  useEffect(() => {
    const previous = collapseStateRef.current;
    let nextMotionClass = '';

    if (previous.chat !== isAiChatCollapsed) {
      nextMotionClass = isAiChatCollapsed ? 'chat-closing' : 'chat-opening';
    } else if (previous.summary !== isAiSummaryCollapsed) {
      nextMotionClass = isAiSummaryCollapsed ? 'summary-closing' : 'summary-opening';
    }

    collapseStateRef.current = {
      summary: isAiSummaryCollapsed,
      chat: isAiChatCollapsed,
    };

    if (!nextMotionClass) return;
    setLayoutMotionClass(nextMotionClass);
    if (motionTimerRef.current) clearTimeout(motionTimerRef.current);
    motionTimerRef.current = setTimeout(() => {
      setLayoutMotionClass('');
      motionTimerRef.current = null;
    }, 280);
  }, [isAiSummaryCollapsed, isAiChatCollapsed]);

  useEffect(() => () => {
    if (motionTimerRef.current) clearTimeout(motionTimerRef.current);
  }, []);

  if (!aiModalOpen) return null;

  return (
    <div class="ai-modal-overlay" onClick={closeAiModal}>
      <div
        class="ai-modal panel"
        ref={aiModalRef}
        style={{
          width: `min(${aiModalWidth}px, calc(100vw - 24px))`,
          height: `min(${aiModalHeight}px, calc(100vh - 32px))`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          class="ai-modal-resizer ai-modal-resizer-left"
          onMouseDown={(e) => startAiModalResize(e, 'left')}
          onDblClick={resetAiModalWidth}
          title="Drag to resize (double-click to reset)"
        />
        <div
          class="ai-modal-resizer ai-modal-resizer-right"
          onMouseDown={(e) => startAiModalResize(e, 'right')}
          onDblClick={resetAiModalWidth}
          title="Drag to resize (double-click to reset)"
        />
        <div
          class="ai-modal-height-resizer ai-modal-height-resizer-top"
          onMouseDown={(e) => startAiModalHeightResize(e, 'top')}
          onDblClick={resetAiModalHeight}
          title="Drag to resize height (double-click to reset)"
        />
        <div
          class="ai-modal-height-resizer"
          onMouseDown={(e) => startAiModalHeightResize(e, 'bottom')}
          onDblClick={resetAiModalHeight}
          title="Drag to resize height (double-click to reset)"
        />
        <div class="ai-modal-head">
          <div class="ai-modal-title">
            {aiActiveItem && (
              <a
                href={aiItemLink}
                target="_blank"
                rel="noreferrer"
                title={aiActiveItem.title}
              >
                {aiActiveItem.title}
              </a>
            )}
          </div>
          <button class="icon-btn" onClick={closeAiModal} title="Close">×</button>
        </div>

        {aiModalLoading ? (
          <div class="ai-loading-shell">
            <div class="ai-loading-spinner">
              <span class="ring ring-a" />
              <span class="ring ring-b" />
              <span class="ring ring-c" />
            </div>
            <div class="ai-loading-title">{aiModalLoadingTitle || 'Building your summary'}</div>
            <div class="ai-loading-subtitle">Reading page content, collecting context, and preparing Q&A.</div>
          </div>
        ) : (
          <div class="ai-modal-content">
            <div class="ai-meta-strip">
              <span class="ai-chip">
                <span class="ai-chip-glyph" aria-hidden="true">{typeIcons[aiActiveItem?.type] || '📄'}</span>
                <span>Type: {aiActiveItem?.type || 'page'}</span>
              </span>
              <span class="ai-chip ai-chip-hoverable" tabIndex={0}>
                <img
                  class="ai-chip-avatar"
                  src={aiSpaceIconSrc}
                  alt=""
                  onError={(e) => { e.currentTarget.src = fallbackSpaceIcon; }}
                />
                <span>Space: {aiActiveItem?.space?.name || 'N/A'}</span>
                <span class="ai-chip-popover" role="tooltip" aria-hidden="true">
                  <img
                    class="ai-chip-popover-avatar"
                    src={aiSpaceIconSrc}
                    alt=""
                    onError={(e) => { e.currentTarget.src = fallbackSpaceIcon; }}
                  />
                  <span class="ai-chip-popover-meta">
                    <span class="ai-chip-popover-label">Space</span>
                    <span class="ai-chip-popover-name">{aiActiveItem?.space?.name || 'N/A'}</span>
                  </span>
                </span>
              </span>
              <span class="ai-chip ai-chip-hoverable" tabIndex={0}>
                <img
                  class="ai-chip-avatar"
                  src={aiContributorIconSrc}
                  alt=""
                  onError={(e) => { e.currentTarget.src = fallbackUserIcon; }}
                />
                <span>Contributor: {aiContributorName}</span>
                <span class="ai-chip-popover ai-chip-popover-right" role="tooltip" aria-hidden="true">
                  <img
                    class="ai-chip-popover-avatar"
                    src={aiContributorIconSrc}
                    alt=""
                    onError={(e) => { e.currentTarget.src = fallbackUserIcon; }}
                  />
                  <span class="ai-chip-popover-meta">
                    <span class="ai-chip-popover-label">Contributor</span>
                    <span class="ai-chip-popover-name">{aiContributorName}</span>
                  </span>
                </span>
              </span>
              <div class="ai-top-controls">
                <div class="ai-visibility-controls">
                  <button
                    class={`pane-toggle-btn ai-visibility-btn ${isAiSummaryCollapsed ? '' : 'is-selected'}`.trim()}
                    onClick={toggleSummaryPane}
                    aria-pressed={isAiSummaryCollapsed ? 'false' : 'true'}
                  >
                    Summary
                  </button>
                  <button
                    class={`pane-toggle-btn ai-visibility-btn ${isAiChatCollapsed ? '' : 'is-selected'}`.trim()}
                    onClick={toggleChatPane}
                    aria-pressed={isAiChatCollapsed ? 'false' : 'true'}
                  >
                    Chat
                  </button>
                </div>
                <div class="ai-model-picker">
                  <CustomSelect
                    id="ai-model-modal"
                    ariaLabel="AI model"
                    value={selectedAiModel}
                    options={aiModelOptions}
                    onChange={changeAiModel}
                    className="ai-model-select ai-model-select--pill"
                    triggerClassName="ai-model-select-trigger ai-model-select-trigger--pill"
                    panelClassName="ai-model-select-panel"
                    optionClassName="ai-model-select-option"
                  />
                </div>
              </div>
            </div>

            <div
              class={`ai-layout ${isAiSummaryCollapsed ? 'summary-collapsed' : ''} ${isAiChatCollapsed ? 'chat-collapsed' : ''} ${layoutMotionClass}`.trim()}
              ref={aiLayoutRef}
              style={{ '--summary-width': `${Math.round(aiSummaryPaneRatio * 100)}%` }}
            >
              <section class="ai-summary-panel">
                <div class="ai-section-head">
                  <h3 class="ai-thread-title">Summary</h3>
                  <div class="ai-section-head-actions">
                    {!isAiSummaryCollapsed && (
                      <button
                        class={`pane-toggle-btn pane-resummarize-btn ${aiSummaryRefreshing ? 'is-loading' : ''}`.trim()}
                        onClick={resummarizeActiveItem}
                        disabled={aiSummaryRefreshing || aiAnswerLoading}
                        aria-busy={aiSummaryRefreshing ? 'true' : 'false'}
                      >
                        {aiSummaryRefreshing ? (
                          <span class="pane-btn-loading">
                            <span class="pane-btn-spinner" aria-hidden="true" />
                            <span>Re-summarizing...</span>
                          </span>
                        ) : 'Re-summarize'}
                      </button>
                    )}
                    <div class="pane-font-controls" title="Adjust summary text size">
                      <button
                        class="pane-font-btn"
                        onClick={() => adjustAiSummaryFontSize(-aiFontSizeStepPx)}
                        disabled={aiSummaryFontSize <= minAiSummaryFontSizePx}
                      >
                        A-
                      </button>
                      <button
                        class="pane-font-btn"
                        onClick={() => adjustAiSummaryFontSize(aiFontSizeStepPx)}
                        disabled={aiSummaryFontSize >= maxAiSummaryFontSizePx}
                      >
                        A+
                      </button>
                    </div>
                  </div>
                </div>
                <section
                  class="ai-summary"
                  ref={aiSummaryRef}
                  dir={aiSummaryDirection}
                  style={{ fontSize: `${aiSummaryFontSize}px` }}
                  dangerouslySetInnerHTML={{ __html: aiSummaryHtml }}
                />
              </section>

              {!isAiSummaryCollapsed && !isAiChatCollapsed && (
                <div
                  class="ai-pane-resizer"
                  onMouseDown={startAiPaneResize}
                  onDblClick={resetAiSummaryPaneRatio}
                  title="Drag to resize summary and chat panes (double-click to reset)"
                />
              )}

              <section class="ai-chat-panel">
                <div class="ai-section-head">
                  <h3 class="ai-thread-title">Follow-up Questions</h3>
                  <div class="ai-section-head-actions">
                    <button
                      class="pane-toggle-btn pane-clear-btn"
                      onClick={clearAiConversation}
                      disabled={aiAnswerLoading || aiModalLoading}
                    >
                      Clear chat
                    </button>
                    <div class="pane-font-controls" title="Adjust chat text size">
                      <button
                        class="pane-font-btn"
                        onClick={() => adjustAiChatFontSize(-aiFontSizeStepPx)}
                        disabled={aiChatFontSize <= minAiChatFontSizePx}
                      >
                        A-
                      </button>
                      <button
                        class="pane-font-btn"
                        onClick={() => adjustAiChatFontSize(aiFontSizeStepPx)}
                        disabled={aiChatFontSize >= maxAiChatFontSizePx}
                      >
                        A+
                      </button>
                    </div>
                  </div>
                </div>
                <div class="ai-thread" ref={aiThreadRef} style={{ '--chat-font-size': `${aiChatFontSize}px` }}>
                  {aiConversation.slice(3).map((msg, idx) => (
                    msg.role === 'assistant' ? (
                      <div
                        key={`${msg.role}-${idx}`}
                        class="qa-entry assistant"
                        dir={detectDirectionFromHtml(msg.content)}
                        dangerouslySetInnerHTML={{ __html: sanitizeHtmlFragment(msg.content) }}
                      />
                    ) : (
                      <div key={`${msg.role}-${idx}`} class="qa-entry user" dir={detectDirection(msg.content)}>
                        {msg.content}
                      </div>
                    )
                  ))}
                  {aiAnswerLoading && (
                    <div class="qa-entry assistant typing-bubble">
                      <span class="typing-label">Thinking</span>
                      <span class="typing-dots">
                        <span class="dot" />
                        <span class="dot" />
                        <span class="dot" />
                      </span>
                    </div>
                  )}
                </div>

                <div class="ai-input-area">
                  <div
                    class="ai-question-resize-handle"
                    onMouseDown={startAiQuestionInputResize}
                    onDblClick={resetAiQuestionInputHeight}
                    title="Drag to resize question input (double-click to reset)"
                  />
                  <div class="ai-question-row">
                    <textarea
                      ref={aiQuestionInputRef}
                      dir="auto"
                      value={aiQuestion}
                      onInput={(e) => setAiQuestion(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          submitAiQuestion();
                        }
                      }}
                      placeholder="Ask a follow-up question..."
                      style={{ height: `${aiQuestionInputHeight}px` }}
                    />
                    <button
                      class="btn ai-action-btn ask compact"
                      style={{ height: `${aiQuestionInputHeight}px` }}
                      onClick={submitAiQuestion}
                      disabled={aiAnswerLoading || aiModalLoading}
                    >
                      {aiAnswerLoading ? 'Thinking...' : 'Ask'}
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
