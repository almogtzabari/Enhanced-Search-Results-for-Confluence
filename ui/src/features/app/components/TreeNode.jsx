import { typeIcons } from '../constants.js';

export function TreeNode({
  node,
  collapsed,
  onToggle,
  highlightResultRows,
  showTreeTooltips,
  onShowTooltip,
  onMoveTooltip,
  onHideTooltip,
  canSummarize,
  aiLoadingItemId,
  aiSummaryStatusById,
  onSummarize,
}) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.id);
  const aiStatus = aiLoadingItemId === node.id ? 'loading' : (aiSummaryStatusById[node.id] || 'idle');
  const aiLabel = aiStatus === 'loading'
    ? 'Thinking...'
    : aiStatus === 'ready'
      ? 'Open'
      : 'Summarize';

  return (
    <li class="tree-item">
      <div
        class={`tree-row ${(node.isResult && highlightResultRows) ? 'tree-row-result' : 'tree-row-parent'}`}
        onMouseEnter={(e) => {
          if (showTreeTooltips) onShowTooltip?.(e, node);
        }}
        onMouseMove={(e) => {
          if (showTreeTooltips) onMoveTooltip?.(e, node);
        }}
        onMouseLeave={() => {
          if (showTreeTooltips) onHideTooltip?.();
        }}
      >
        {hasChildren ? (
          <button class="toggle" onClick={() => onToggle(node.id)} title="Toggle">
            {isCollapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span class="toggle" />
        )}
        <span class="node-kind">{typeIcons[node.type] || '📄'}</span>
        <a class="node-link" href={node.url} target="_blank" rel="noreferrer" title={node.title}>
          {node.title}
        </a>
        {canSummarize && node.sourceItem && (
          <button
            class="mini-ai-btn"
            onClick={() => onSummarize(node.sourceItem)}
            disabled={aiStatus === 'loading'}
            title="AI Summary"
            data-status={aiStatus}
            aria-busy={aiStatus === 'loading' ? 'true' : 'false'}
          >
            <span class="mini-ai-btn__icon" aria-hidden="true" />
            <span class="mini-ai-btn__label">{aiLabel}</span>
          </button>
        )}
      </div>

      {hasChildren && !isCollapsed && (
        <ul class="tree-list">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              collapsed={collapsed}
              onToggle={onToggle}
              highlightResultRows={highlightResultRows}
              showTreeTooltips={showTreeTooltips}
              onShowTooltip={onShowTooltip}
              onMoveTooltip={onMoveTooltip}
              onHideTooltip={onHideTooltip}
              canSummarize={canSummarize}
              aiLoadingItemId={aiLoadingItemId}
              aiSummaryStatusById={aiSummaryStatusById}
              onSummarize={onSummarize}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
