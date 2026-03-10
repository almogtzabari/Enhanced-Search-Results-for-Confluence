export function TreeTooltip({
  treeTooltipData,
  treeTooltipRef,
  typeIcons,
  typeLabels,
  fallbackUserIcon,
  fallbackSpaceIcon,
}) {
  if (!treeTooltipData) return null;

  return (
    <div class="tree-tooltip-v2" ref={treeTooltipRef}>
      <div class="tree-tooltip-v2-head">
        <div class="tree-tooltip-v2-title-wrap">
          <div class="tree-tooltip-v2-kicker">
            <span aria-hidden="true">{typeIcons[treeTooltipData.type] || '📄'}</span>
            <span>{typeLabels[treeTooltipData.type] || treeTooltipData.type || 'Page'}</span>
          </div>
          <a class="tree-tooltip-v2-title" href={treeTooltipData.url} target="_blank" rel="noreferrer">
            {treeTooltipData.title}
          </a>
        </div>
      </div>
      <div class="tree-tooltip-v2-row">
        <img
          class="tree-tooltip-avatar"
          src={treeTooltipData.avatarUrl}
          alt=""
          onError={(e) => { e.currentTarget.src = fallbackUserIcon; }}
        />
        <div class="tree-tooltip-v2-meta">
          <div class="tree-tooltip-v2-label">Contributor</div>
          <div class="tree-tooltip-v2-value">{treeTooltipData.contributor}</div>
        </div>
      </div>
      <div class="tree-tooltip-v2-row">
        <img
          class="tree-tooltip-space-mini"
          src={treeTooltipData.spaceIconUrl}
          alt=""
          onError={(e) => { e.currentTarget.src = fallbackSpaceIcon; }}
        />
        <div class="tree-tooltip-v2-meta">
          <div class="tree-tooltip-v2-label">Space</div>
          <div class="tree-tooltip-v2-value">{treeTooltipData.spaceName}</div>
        </div>
      </div>
      <div class="tree-tooltip-v2-footer">Last modified: {treeTooltipData.modified}</div>
    </div>
  );
}
