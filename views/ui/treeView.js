// =========================================================
//                    TREE VIEW FUNCTIONS
// =========================================================
import { dom } from '../domElements.js';
import * as state from '../state.js';
import { log, typeIcons, typeLabels } from '../config.js';
import { escapeHtml, buildConfluenceUrl, formatDate } from '../utils/generalUtils.js';
import { attachScrollListenerTo } from '../eventManager.js';

function generateTreeHtml(nodesToRender) {
    let html = '<ul>';
    for (const node of nodesToRender) {
        const isResult = node.isSearchResult;
        const hasChildren = node.children && node.children.length > 0;
        const id = `node-${node.id}`;
        const isCollapsed = state.collapsedNodes.has(id);
        const arrowClass = hasChildren ? (isCollapsed ? 'collapsed' : 'expanded') : 'empty';
        const tooltipAttrs = isResult && state.tooltipSettings.showTooltips ? ` data-title="${escapeHtml(node.title)}" data-contributor="${escapeHtml(node.contributor)}" data-modified="${escapeHtml(node.modified)}" data-type="${node.type}"` : '';
        const icon = typeIcons[node.type] || '📄';
        html += `<li id="${id}" class="${isResult ? 'search-result' : 'ancestor'}"${tooltipAttrs}>`;
        html += `<span class="arrow ${arrowClass}"></span> <a href="${node.url}" class="tree-node" target="_blank">${isResult ? `${icon}&nbsp;&nbsp;` : ''}${escapeHtml(node.title)}</a>`;
        if (isResult && state.ENABLE_SUMMARIES) {
            const btnText = state.summaryCache.has(node.id) ? '✅ Summary Available!' : '🧠 Summarize';
            html += `<div><button class="summarize-button" data-id="${node.id}">${btnText}</button></div>`;
        }
        if (hasChildren) { html += `<div class="children" style="display: ${isCollapsed ? 'none' : 'block'};">${generateTreeHtml(node.children)}</div>`; }
        html += '</li>';
    }
    html += '</ul>';
    return html;
}

export function updateTreeHtml(resultsToDisplay) {
    const currentCollapsed = document.querySelectorAll('#tree-container .arrow.collapsed');
    state.collapsedNodes.clear();
    currentCollapsed.forEach(arrow => {
        const li = arrow.closest('li');
        if (li?.id) state.collapsedNodes.add(li.id);
    });
    state.setNodeMap({});
    state.setRoots([]);

    for (const pageData of resultsToDisplay) {
        if (pageData.ancestors) {
            for (const ancestor of pageData.ancestors) {
                if (!state.nodeMap[ancestor.id]) {
                    state.nodeMap[ancestor.id] = { id: ancestor.id, title: ancestor.title, url: buildConfluenceUrl(ancestor._links.webui), children: [], isSearchResult: false, type: 'page' };
                }
            }
        }
        if (!state.nodeMap[pageData.id]) {
            state.nodeMap[pageData.id] = {
                id: pageData.id, title: pageData.title, url: buildConfluenceUrl(pageData._links.webui), children: [], isSearchResult: true,
                contributor: pageData.history?.createdBy?.displayName || 'Unknown',
                modified: pageData.version?.when ? formatDate(pageData.version.when) : 'N/A',
                type: pageData.type || 'page'
            };
        } else {
            state.nodeMap[pageData.id].isSearchResult = true;
            state.nodeMap[pageData.id].contributor = pageData.history?.createdBy?.displayName || 'Unknown';
            state.nodeMap[pageData.id].modified = pageData.version?.when ? formatDate(pageData.version.when) : 'N/A';
            state.nodeMap[pageData.id].type = pageData.type || 'page';
        }
    }

    for (const pageData of resultsToDisplay) {
        const pageNode = state.nodeMap[pageData.id];
        if (!pageNode) continue;
        const ancestors = pageData.ancestors || [];
        if (ancestors.length > 0) {
            let parentNode = null;
            for (let i = 0; i < ancestors.length; i++) {
                const ancestorData = ancestors[i];
                const ancestorNode = state.nodeMap[ancestorData.id];
                if (!ancestorNode) continue;

                if (parentNode && !parentNode.children.some(child => child.id === ancestorNode.id)) {
                    parentNode.children.push(ancestorNode);
                }
                parentNode = ancestorNode;
            }
            if (parentNode && !parentNode.children.some(child => child.id === pageNode.id)) {
                parentNode.children.push(pageNode);
            }
            const rootAncestor = state.nodeMap[ancestors[0].id];
            if (rootAncestor && !state.roots.some(root => root.id === rootAncestor.id)) {
                state.roots.push(rootAncestor);
            }
        } else {
            if (!state.roots.some(root => root.id === pageNode.id)) {
                state.roots.push(pageNode);
            }
        }
    }
    log.debug(`[Tree] Rendering with ${state.roots.length} root nodes. NodeMap size: ${Object.keys(state.nodeMap).length}`);
    if (dom.treeContainer) dom.treeContainer.innerHTML = generateTreeHtml(state.roots);
    updateTooltipDisplayState();
}


export function handleTreeArrowClick(event) {
    const arrow = event.target.closest('.arrow');
    if (!arrow || arrow.classList.contains('empty')) return;
    const li = arrow.closest('li');
    const childrenDiv = li?.querySelector('.children');
    if (!childrenDiv) return;
    const isCollapsed = childrenDiv.style.display === 'none';
    childrenDiv.style.display = isCollapsed ? 'block' : 'none';
    arrow.classList.toggle('collapsed', !isCollapsed);
    arrow.classList.toggle('expanded', isCollapsed);
    if (li?.id) { isCollapsed ? state.collapsedNodes.delete(li.id) : state.collapsedNodes.add(li.id); }
}

export function switchToTreeView() {
    if (!dom.treeViewBtn || !dom.tableViewBtn || !dom.treeContainer || !dom.tableContainer) return;
    const isTreeActive = dom.treeViewBtn.classList.contains('active');
    if (isTreeActive) {
        state.setAllExpanded(!state.allExpanded);
        log.debug('Toggling Tree View expand state to:', state.allExpanded);
        document.querySelectorAll('#tree-container .children').forEach(div => div.style.display = state.allExpanded ? 'block' : 'none');
        document.querySelectorAll('#tree-container .arrow:not(.empty)').forEach(arrow => {
            arrow.classList.toggle('collapsed', !state.allExpanded);
            arrow.classList.toggle('expanded', state.allExpanded);
        });
        state.collapsedNodes.clear();
        if (!state.allExpanded) {
            document.querySelectorAll('#tree-container .arrow.collapsed').forEach(arrow => {
                const liItem = arrow.closest('li');
                if (liItem?.id) state.collapsedNodes.add(liItem.id);
            });
        }
    } else {
        log.debug('Switching to Tree View');
        dom.treeContainer.style.display = 'block';
        dom.tableContainer.style.display = 'none';
        dom.treeViewBtn.classList.add('active');
        dom.tableViewBtn.classList.remove('active');
        state.setAllExpanded(true);
        document.querySelectorAll('#tree-container .children').forEach(div => div.style.display = 'block');
        document.querySelectorAll('#tree-container .arrow:not(.empty)').forEach(arrow => {
            arrow.classList.remove('collapsed');
            arrow.classList.add('expanded');
        });
        state.collapsedNodes.clear();
    }
    attachScrollListenerTo(document.querySelector('.container'));
}

function attachTooltipListenersToTreeNodes() {
    if (!dom.treeTooltip) return;
    document.querySelectorAll('#tree-container .search-result').forEach(node => {
        if (state.tooltipBoundNodes.has(node)) return;
        const enter = () => {
            dom.treeTooltip.innerHTML = `<strong>${node.dataset.title}</strong><br>Type: ${typeLabels[node.dataset.type] || 'N/A'}<br>By: ${node.dataset.contributor}<br>Modified: ${node.dataset.modified}`;
            dom.treeTooltip.style.display = 'block';
        };
        const move = e => {
            dom.treeTooltip.style.left = `${e.pageX + 10}px`;
            dom.treeTooltip.style.top = `${e.pageY + 10}px`;
        };
        const leave = () => { dom.treeTooltip.style.display = 'none'; };
        node.addEventListener('mouseenter', enter);
        node.addEventListener('mousemove', move);
        node.addEventListener('mouseleave', leave);
        state.tooltipBoundNodes.set(node, { enter, move, leave });
    });
}

function detachTooltipListenersFromTreeNodes() {
    if (dom.treeTooltip) dom.treeTooltip.style.display = 'none';
    document.querySelectorAll('#tree-container .search-result').forEach(node => {
        const handlers = state.tooltipBoundNodes.get(node);
        if (handlers) {
            node.removeEventListener('mouseenter', handlers.enter);
            node.removeEventListener('mousemove', handlers.move);
            node.removeEventListener('mouseleave', handlers.leave);
            state.tooltipBoundNodes.delete(node);
        }
    });
}

export function updateTooltipDisplayState() {
    if (!dom.treeTooltip) {
        dom.treeTooltip = document.createElement('div');
        dom.treeTooltip.id = 'tree-tooltip';
        dom.treeTooltip.className = 'tree-tooltip';
        document.body.appendChild(dom.treeTooltip);
    }
    chrome.storage.sync.get(['showTooltips'], (data) => {
        state.tooltipSettings.showTooltips = data.showTooltips !== false;
        detachTooltipListenersFromTreeNodes();
        if (state.tooltipSettings.showTooltips) attachTooltipListenersToTreeNodes();
    });
}