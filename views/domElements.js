// =========================================================
//                    DOM ELEMENTS CACHE
// =========================================================

export const dom = {};

export function cacheDomElements() {
    dom.treeContainer = document.getElementById('tree-container');
    dom.tableContainer = document.getElementById('table-container');
    dom.spaceOptionsContainer = document.getElementById('space-options');
    dom.contributorOptionsContainer = document.getElementById('contributor-options');
    dom.spaceFilterInput = document.getElementById('space-filter');
    dom.contributorFilterInput = document.getElementById('contributor-filter');
    dom.textFilterInput = document.getElementById('text-filter');
    dom.dateFilter = document.getElementById('date-filter');
    dom.typeFilter = document.getElementById('type-filter');
    dom.newSearchInput = document.getElementById('new-search-input');
    dom.newSearchButton = document.getElementById('new-search-button');
    dom.mainSearchClear = document.getElementById('main-search-clear');
    dom.scrollToTopButton = document.getElementById('scroll-to-top');
    dom.summaryModal = document.getElementById('summary-modal');
    dom.resizableModal = document.getElementById('resizable-modal');
    dom.globalLoadingOverlay = document.getElementById('global-loading-overlay');
    dom.pageTitle = document.getElementById('page-title');
    dom.treeViewBtn = document.getElementById('tree-view-btn');
    dom.tableViewBtn = document.getElementById('table-view-btn');
    dom.filterTextClear = document.getElementById('filter-text-clear');
    dom.spaceClear = document.getElementById('space-clear');
    dom.contributorClear = document.getElementById('contributor-clear');
    dom.openOptionsButton = document.getElementById('open-options');
    dom.poofAudio = document.getElementById('poof-audio');
    dom.treeTooltip = null; // Will be created dynamically
    dom.TableTooltip = null; // Will be created dynamically
    dom.modalBody = document.getElementById('modal-body');
    dom.modalClose = document.getElementById('modal-close');
    dom.summaryTitle = document.getElementById('summary-title');
    dom.modalResizer = document.getElementById('modal-resizer');
    dom.modalResizerLeft = document.getElementById('modal-resizer-left');
}