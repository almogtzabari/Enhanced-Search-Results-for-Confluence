// =========================================================
//                    TABLE VIEW FUNCTIONS
// =========================================================
import { dom } from '../domElements.js';
import * as state from '../state.js';
import { log, typeIcons, typeLabels, DEFAULT_COL_WIDTHS } from '../config.js';
import { escapeHtml, buildConfluenceUrl, formatDate } from '../utils/generalUtils.js';
import { processAndRenderResults } from '../core/dataProcessor.js';
import { attachScrollListenerTo } from '../eventManager.js';


export function updateSortIcons() {
    document.querySelectorAll('#table-container th').forEach(th => {
        const icon = th.querySelector('.sort-icon');
        const col = th.dataset.column;
        if (!icon) return;

        if (state.currentSortColumn === col) {
            icon.textContent = state.currentSortOrder === 'asc' ? '↑' : state.currentSortOrder === 'desc' ? '↓' : '';
        } else {
            icon.textContent = '';
        }
    });
}

export function updateTableHtml(resultsToDisplay) {
    if (!dom.tableContainer) return;
    log.debug('[Table] Rendering', resultsToDisplay.length, 'rows');
    dom.tableContainer.innerHTML = '';

    const headerWrapper = document.createElement('div');
    headerWrapper.className = 'table-header-wrapper';
    const bodyWrapper = document.createElement('div');
    bodyWrapper.className = 'table-body-wrapper';

    const headerTable = document.createElement('table');
    headerTable.style.tableLayout = 'fixed';
    headerTable.style.width = '100%';

    const headerColGroup = document.createElement('colgroup');
    const resizerElements = [];
    state.colWidths.forEach((width) => {
        const col = document.createElement('col');
        col.style.width = `${width}px`;
        headerColGroup.appendChild(col);
    });
    headerTable.appendChild(headerColGroup);

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const headers = ['Type', 'Name', 'Space', 'Contributor', 'Date Created', 'Last Modified'];
    headers.forEach((headerText, idx) => {
        const th = document.createElement('th');
        th.dataset.column = headerText;
        const resizer = document.createElement('span');
        resizer.className = 'th-resizer';
        resizerElements.push({ el: resizer, idx });
        th.innerHTML = `<span>${headerText}</span><span class="sort-icon"></span>`;
        th.appendChild(resizer);
        th.addEventListener('click', handleTableSortClick);
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    headerTable.appendChild(thead);
    headerWrapper.appendChild(headerTable);

    const bodyTable = document.createElement('table');
    bodyTable.style.tableLayout = 'fixed';
    bodyTable.style.width = '100%';

    const bodyColGroup = document.createElement('colgroup');
    state.colWidths.forEach(width => {
        const col = document.createElement('col');
        col.style.width = `${width}px`;
        bodyColGroup.appendChild(col);
    });
    bodyTable.appendChild(bodyColGroup);

    const tbody = document.createElement('tbody');
    resultsToDisplay.forEach(page => {
        const row = document.createElement('tr');
        const creator = page.history?.createdBy;
        const creatorId = creator ? (creator.username || creator.userKey || creator.accountId) : '';
        row.innerHTML = `
        <td><span title="${typeLabels[page.type] || page.type}" style="font-size: 2.0em;">${typeIcons[page.type] || '📄'}</span></td>
        <td><div style="display: flex; flex-direction: column; align-items: flex-start;"><a href="${buildConfluenceUrl(page._links.webui)}" target="_blank" class="multiline-ellipsis" title="${escapeHtml(page.title)}">${escapeHtml(page.title)}</a><button class="summarize-button" data-id="${page.id}" style="display: ${state.ENABLE_SUMMARIES ? 'inline-block' : 'none'};">${state.summaryCache.has(page.id) ? '✅ Summary Available!' : '🧠 Summarize'}</button></div></td>
        <td>${page.space ? `<div class="space-cell"><img src="${page.space.iconUrl || `${state.baseUrl}/images/logo/default-space-logo.svg`}" class="space-icon" alt="" data-name="${escapeHtml(page.space.name)}" data-url="${buildConfluenceUrl(page.space._links?.webui)}"><a href="${buildConfluenceUrl(page.space._links?.webui)}" target="_blank" class="multiline-ellipsis" title="${escapeHtml(page.space.name)}">${escapeHtml(page.space.name)}</a></div>` : ''}</td>
        <td>${creator ? `<div class="contributor-cell"><img src="${creator.avatarUrl}" class="contributor-avatar" alt="" loading="lazy" data-name="${escapeHtml(creator.displayName)}" data-url="${creatorId ? `${state.baseUrl}/display/~${creatorId}` : '#'}"><a href="${creatorId ? `${state.baseUrl}/display/~${creatorId}` : '#'}" target="_blank" class="multiline-ellipsis" title="${escapeHtml(creator.displayName)}">${escapeHtml(creator.displayName)}</a></div>` : 'Unknown'}</td>
        <td>${page.history?.createdDate ? formatDate(page.history.createdDate) : 'N/A'}</td>
        <td>${page.version?.when ? formatDate(page.version.when) : 'N/A'}</td>`;
        tbody.appendChild(row);
    });

    bodyTable.appendChild(tbody);
    bodyWrapper.appendChild(bodyTable);

    resizerElements.forEach(({ el, idx }) =>
        attachColResizer(el, idx, headerColGroup, bodyColGroup)
    );
    dom.tableContainer.appendChild(headerWrapper);
    dom.tableContainer.appendChild(bodyWrapper);
    updateSortIcons();
    syncTableHorizontalScroll();
    if (dom.tableViewBtn?.classList.contains('active')) {
        attachScrollListenerTo(bodyWrapper);
    }

    chrome.storage.sync.get(['showTableTooltips'], data => {
        if (data.showTableTooltips !== false) {
            detachTableTooltipListeners();
            attachTableTooltipListeners();
        }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        if ('showTooltips' in changes) {
            updateTableHtml(state.filteredResults); // Re-render to apply new tooltip setting
        }
    });
}

function attachColResizer(resizerEl, idx, headerColGroup, bodyColGroup, minWidth = 60) {
    const headerCols = headerColGroup.children;
    const bodyCols = bodyColGroup.children;

    const syncWidths = () => {
        for (let i = 0; i < state.colWidths.length; i++) {
            headerCols[i].style.width = `${state.colWidths[i]}px`;
            bodyCols[i].style.width = `${state.colWidths[i]}px`;
        }
    };
    resizerEl.addEventListener('pointerdown', e => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startW = state.colWidths[idx];
        const move = ev => {
            state.colWidths[idx] = Math.max(startW + ev.clientX - startX, minWidth);
            syncWidths();
        };
        const up = () => {
            document.body.style.cursor = '';
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
        document.body.style.cursor = 'col-resize';
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    });
    resizerEl.addEventListener('dblclick', e => {
        e.preventDefault();
        e.stopPropagation();
        state.colWidths[idx] = DEFAULT_COL_WIDTHS[idx];
        syncWidths();
    });
}

function syncTableHorizontalScroll() {
    const tableBodyWrapper = document.querySelector('.table-body-wrapper');
    const tableHeaderWrapper = document.querySelector('.table-header-wrapper');
    if (tableBodyWrapper && tableHeaderWrapper) {
        if (tableBodyWrapper.dataset.syncScrollAttached === 'true') {
            log.debug('Table scroll synchronization already set up.');
            return;
        }

        log.debug('Setting up table scroll synchronization');
        tableBodyWrapper.addEventListener('scroll', () => {
            tableHeaderWrapper.scrollLeft = tableBodyWrapper.scrollLeft;
        });
        tableBodyWrapper.dataset.syncScrollAttached = 'true';
    } else {
        log.warn('Table scroll synchronization not set up: tableBodyWrapper or tableHeaderWrapper is missing.');
    }
}

export function handleTableSortClick(event) {
    if (event.target.classList.contains('th-resizer')) return;
    const column = event.currentTarget.dataset.column;

    if (state.currentSortColumn === column) {
        if (state.currentSortOrder === 'asc') state.setCurrentSortOrder('desc');
        else if (state.currentSortOrder === 'desc') { state.setCurrentSortOrder(''); state.setCurrentSortColumn(''); }
        else state.setCurrentSortOrder('asc');
    } else {
        state.setCurrentSortColumn(column);
        state.setCurrentSortOrder('asc');
    }

    updateSortIcons();
    processAndRenderResults(true);
}

export function switchToTableView() {
    if (!dom.treeContainer || !dom.tableContainer || !dom.treeViewBtn || !dom.tableViewBtn) return;
    log.debug('Switching to Table View');
    dom.treeContainer.style.display = 'none';
    dom.tableContainer.style.display = 'block';
    dom.treeViewBtn.classList.remove('active');
    dom.tableViewBtn.classList.add('active');
    syncTableHorizontalScroll();
    attachScrollListenerTo(document.querySelector('.table-body-wrapper'));
}

function attachTableTooltipListeners() {
    if (!dom.tableTooltip) {
        dom.tableTooltip = document.createElement('div');
        dom.tableTooltip.id = 'table-tooltip';
        dom.tableTooltip.className = 'table-tooltip';
        document.body.appendChild(dom.tableTooltip);
    }
    const tooltip = dom.tableTooltip;

    document.querySelectorAll('.contributor-avatar, .space-icon').forEach(icon => {
        icon.addEventListener('mouseenter', () => {
            const name = icon.dataset.name || '';
            const url = icon.dataset.url || '#';
            const escapedName = escapeHtml(name);
            const escapedUrl = escapeHtml(url);
            while (tooltip.firstChild) {
                tooltip.removeChild(tooltip.firstChild);
            }

            const img = document.createElement('img');
            img.src = icon.src;
            img.alt = escapedName;
            tooltip.appendChild(img);

            tooltip.appendChild(document.createElement('br'));

            const link = document.createElement('a');
            link.href = escapedUrl;
            link.target = '_blank';
            link.textContent = escapedName;
            tooltip.appendChild(link);
            tooltip.style.display = 'block';
        });

        icon.addEventListener('mousemove', e => {
            tooltip.style.left = `${e.pageX + 10}px`;
            tooltip.style.top = `${e.pageY + 10}px`;
        });

        icon.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });
    });
}

function detachTableTooltipListeners() {
    if (dom.tableTooltip) dom.tableTooltip.style.display = 'none';
    document.querySelectorAll('.contributor-avatar, .space-icon').forEach(icon => {
        // Clone node to remove all listeners (simple and effective)
        const clone = icon.cloneNode(true);
        icon.parentNode.replaceChild(clone, icon);
    });
}

export function updateTableTooltipDisplayState() {
    if (!dom.tableTooltip) {
        dom.tableTooltip = document.createElement('div');
        dom.tableTooltip.id = 'table-tooltip';
        dom.tableTooltip.className = 'table-tooltip';
        document.body.appendChild(dom.tableTooltip);
    }
    chrome.storage.sync.get(['showTableTooltips'], (data) => {
        state.tableTooltipSettings.showTooltips = data.showTableTooltips !== false;
        detachTableTooltipListeners();
        if (state.tableTooltipSettings.showTooltips) attachTableTooltipListeners();
    });
}