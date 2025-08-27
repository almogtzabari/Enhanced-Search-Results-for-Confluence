// =========================================================
//                    FILTER CONTROL FUNCTIONS
// =========================================================
import { dom } from '../domElements.js';
import * as state from '../state.js';
import { log, RESULTS_PER_REQUEST } from '../config.js';
import { toggleClearIcon } from '../utils/uiUtils.js';
import { debounce, escapeHtml, sanitizeInput, updateUrlParams, getQueryParams } from '../utils/generalUtils.js';
import { resetDataAndFetchResults, processAndRenderResults } from '../core/dataProcessor.js';
import { searchSpacesByQuery, searchUsersByQuery } from '../services/apiService.js';

export function populateFiltersFromUrlParams(params) {
    if (dom.textFilterInput) dom.textFilterInput.value = params.text || '';
    if (dom.spaceFilterInput) {
        const [spaceKey, spaceLabel] = (params.space || '').split(':');
        dom.spaceFilterInput.dataset.key = spaceKey || '';
        dom.spaceFilterInput.value = spaceLabel || spaceKey || '';
    }
    if (dom.contributorFilterInput) {
        const [contribKey, contribLabel] = (params.contributor || '').split(':');
        dom.contributorFilterInput.dataset.key = contribKey || '';
        dom.contributorFilterInput.value = contribLabel || contribKey || '';
    }
    if (dom.dateFilter) dom.dateFilter.value = params.date || 'any';
    if (dom.typeFilter) dom.typeFilter.value = params.type || '';

    toggleClearIcon(dom.textFilterInput, dom.filterTextClear);
    toggleClearIcon(dom.spaceFilterInput, dom.spaceClear);
    toggleClearIcon(dom.contributorFilterInput, dom.contributorClear);
}


export function updateFilterOptionsUIDisplay() {
    const newSpaces = [], newContributors = [];
    const currentBatch = state.allResults.slice(Math.max(0, state.start - RESULTS_PER_REQUEST));

    currentBatch.forEach(pageData => {
        if (pageData.space?.key) {
            const iconUrl = pageData.space.icon?.path ? `${state.baseUrl}${pageData.space.icon.path}` : `${state.baseUrl}/images/logo/default-space-logo.svg`;
            pageData.space.iconUrl = iconUrl;

            if (!state.fullSpaceList.find(s => s.key === pageData.space.key) && !newSpaces.find(s => s.key === pageData.space.key)) {
                newSpaces.push({ key: pageData.space.key, name: pageData.space.name, iconUrl });
            }
        }
        const creator = pageData.history?.createdBy;
        if (creator) {
            const key = creator.username || creator.userKey || creator.accountId;
            if (key) {
                const avatarUrl = `${state.baseUrl}${creator.profilePicture?.path || '/images/icons/profilepics/default.png'}`;
                creator.avatarUrl = avatarUrl;

                if (!state.fullContributorList.find(c => c.key === key) && !newContributors.find(c => c.key === key)) {
                    newContributors.push({ key, name: creator.displayName, avatarUrl });
                }
            }
        }
    });
    if (newSpaces.length > 0) {
        state.fullSpaceList.push(...newSpaces);
        state.fullSpaceList.sort((a, b) => a.name.localeCompare(b.name));
    }
    if (newContributors.length > 0) {
        state.fullContributorList.push(...newContributors);
        state.fullContributorList.sort((a, b) => a.name.localeCompare(b.name));
    }
    displayFilteredSpaceOptionsUI(dom.spaceFilterInput.value);
    displayFilteredContributorOptionsUI(dom.contributorFilterInput.value);
}

function displayFilteredSpaceOptionsUI(filterValue) {
    if (!dom.spaceOptionsContainer || !dom.spaceFilterInput) return;
    dom.spaceOptionsContainer.innerHTML = '';
    const q = (filterValue || '').toLowerCase();
    const filtered = state.fullSpaceList.filter(s =>
        s.name.toLowerCase().includes(q) || s.key.toLowerCase().includes(q)
    );
    filtered.forEach(space => {
        const option = document.createElement('div');
        option.className = 'option';
        option.dataset.key = space.key;
        option.title = space.name;
        option.innerHTML = `<img src="${space.iconUrl}" class="space-icon" alt=""> ${escapeHtml(space.name)}`;
        dom.spaceOptionsContainer.appendChild(option);
    });
    addFilterOptionListeners(dom.spaceOptionsContainer, 'space-filter');
}

function displayFilteredContributorOptionsUI(filterValue) {
    if (!dom.contributorOptionsContainer || !dom.contributorFilterInput) return;
    dom.contributorOptionsContainer.innerHTML = '';
    const q = (filterValue || '').toLowerCase();
    const filtered = state.fullContributorList.filter(c =>
        c.name.toLowerCase().includes(q) || c.key.toLowerCase().includes(q)
    );
    filtered.forEach(contributor => {
        const option = document.createElement('div');
        option.className = 'option';
        option.dataset.key = contributor.key;
        option.title = contributor.name;
        option.innerHTML = `<img src="${contributor.avatarUrl}" class="contributor-avatar" alt=""> ${escapeHtml(contributor.name)}`;
        dom.contributorOptionsContainer.appendChild(option);
    });
    addFilterOptionListeners(dom.contributorOptionsContainer, 'contributor-filter');
}

function onTypeFilterChange() {
    log.debug('[Filter] Type changed:', dom.typeFilter.value);
    resetDataAndFetchResults();
}

function onDateFilterChange() {
    log.debug('[Filter] Date changed:', dom.dateFilter.value);
    resetDataAndFetchResults();
}

function addFilterOptionListeners(container, inputId) {
    if (!container) return;
    const options = container.querySelectorAll('.option');
    options.forEach((option, index) => {
        option.dataset.index = index;
        option.onclick = () => {
            selectOption(option, inputId, container);
        };
    });
}

function selectOption(option, inputId, container) {
    const input = document.getElementById(inputId);
    const clearIconId = `${inputId.split('-')[0]}-clear`;
    const clearIcon = document.getElementById(clearIconId);
    if (input) {
        input.value = option.textContent.trim();
        input.dataset.key = option.dataset.key;
    }
    if (container) container.style.display = 'none';
    if (clearIcon && input) toggleClearIcon(input, clearIcon);
    resetDataAndFetchResults();
}

function clearSpaceFilter(evt) {
    evt.stopPropagation();
    log.debug('[Filter] Space filter cleared');
    if (dom.spaceFilterInput) {
        dom.spaceFilterInput.value = '';
        dom.spaceFilterInput.dataset.key = '';
        toggleClearIcon(dom.spaceFilterInput, dom.spaceClear);
        displayFilteredSpaceOptionsUI('');
        resetDataAndFetchResults();
    }
}

function clearContributorFilter(evt) {
    evt.stopPropagation();
    log.debug('[Filter] Contributor filter cleared');
    if (dom.contributorFilterInput) {
        dom.contributorFilterInput.value = '';
        dom.contributorFilterInput.dataset.key = '';
        toggleClearIcon(dom.contributorFilterInput, dom.contributorClear);
        displayFilteredContributorOptionsUI('');
        resetDataAndFetchResults();
    }
}

export function setupFilterInputEventListeners() {
    const debouncedProcessAndRender = debounce(processAndRenderResults, 250);

    if (dom.textFilterInput) {
        dom.textFilterInput.oninput = () => {
            debouncedProcessAndRender();
            toggleClearIcon(dom.textFilterInput, dom.filterTextClear);
            debounce(() => {
                const currentParams = getQueryParams();
                currentParams.text = dom.textFilterInput.value.trim();
                updateUrlParams(currentParams);
            }, 300)();
        };
    }
    if (dom.filterTextClear) {
        dom.filterTextClear.onclick = () => {
            if (dom.textFilterInput) dom.textFilterInput.value = '';
            toggleClearIcon(dom.textFilterInput, dom.filterTextClear);
            processAndRenderResults(true);
            if (dom.textFilterInput) dom.textFilterInput.focus();
            const url = new URL(window.location.href);
            url.searchParams.delete('text');
            history.replaceState(null, '', url.toString());
        };
    }

    if (dom.dateFilter) dom.dateFilter.onchange = onDateFilterChange;
    if (dom.typeFilter) dom.typeFilter.onchange = onTypeFilterChange;

    // ---- Async autocomplete glue (spaces & contributors) ----
    let lastSpaceReqId = 0;

    const runSpaceLookup = debounce(async (term) => {
        const reqId = ++lastSpaceReqId;
        try {
            if (!term || term.length < 2) return;

            const remoteRaw = await searchSpacesByQuery(term, 10);
            if (reqId !== lastSpaceReqId) return; // stale

            // Normalize each item so we always have: key, name, label, value, iconUrl
            const normalizeSpace = (s) => {
                if (!s) return null;

                // If a string sneaks in, turn it into a minimal object
                if (typeof s === 'string') {
                    return { key: s, name: s, label: s, value: s, iconUrl: '' };
                }

                // Try common shapes from Confluence endpoints / CQL results
                const key =
                    s.key ??
                    s.spaceKey ??
                    s.id ??
                    s.space?.key ??
                    ''; // last resort: leave empty (will be filtered out)

                const name =
                    s.name ??
                    s.title ??
                    s.space?.name ??
                    s.space?.title ??
                    '';

                // Icons can be {icon: {path}} or {iconUrl}; make a URL if we only have a path
                const rawIcon =
                    s.iconUrl ??
                    s.icon?.path ??
                    s._links?.icon ??
                    '';

                const iconUrl = rawIcon
                    ? (rawIcon.startsWith('http') ? rawIcon : `${state.baseUrl}${rawIcon}`)
                    : `${state.baseUrl}/images/icons/space_48.png`;

                const label = s.label ?? name;
                const value = s.value ?? (key || name);

                return key && name
                    ? {
                        ...s,
                        key: String(key),
                        name: String(name),
                        label: String(label),
                        value: String(value),
                        iconUrl: String(iconUrl),
                    }
                    : null;
            };

            const remote = (Array.isArray(remoteRaw) ? remoteRaw : [])
                .map(normalizeSpace)
                .filter(Boolean);

            // Merge & de-dupe by key
            const byKey = new Map(state.fullSpaceList.map((s) => [s.key, s]));
            for (const s of remote) byKey.set(s.key, s);

            // Safe comparator that never touches undefined
            const safeCompareByName = (a, b) => {
                const A = (a?.name ?? a?.label ?? a?.title ?? a?.value ?? '').toString();
                const B = (b?.name ?? b?.label ?? b?.title ?? b?.value ?? '').toString();
                return A.localeCompare(B, undefined, { sensitivity: 'base' });
            };

            const merged = Array.from(byKey.values()).sort(safeCompareByName);

            state.fullSpaceList.splice(0, state.fullSpaceList.length, ...merged);
            displayFilteredSpaceOptionsUI(term);
        } catch (err) {
            log.warn('[Spaces] Remote lookup failed:', err);
        }
    }, 250);

    let lastUserReqId = 0;
    const runUserLookup = debounce(async (term) => {
        const reqId = ++lastUserReqId;
        try {
            if (!term || term.length < 2) return;

            // Ensure a .name exists on each item
            const remoteRaw = await searchUsersByQuery(term, 10);
            const remote = remoteRaw.map(u => ({
                ...u,
                name: u.name ?? u.displayName ?? u.label ?? u.username ?? ''  // alias
            }));

            if (reqId !== lastUserReqId) return; // stale

            const byKey = new Map(state.fullContributorList.map(u => [u.key, u]));
            for (const u of remote) byKey.set(u.key, u);

            const safeCompareByName = (a, b) => {
                const A = (a?.name ?? '').toString();
                const B = (b?.name ?? '').toString();
                return A.localeCompare(B, undefined, { sensitivity: 'base' });
            };

            const merged = Array.from(byKey.values()).sort(safeCompareByName);
            state.fullContributorList.splice(0, state.fullContributorList.length, ...merged);

            displayFilteredContributorOptionsUI(term);
        } catch (err) {
            log.warn('[Users] Remote lookup failed:', err);
        }
    }, 250);

    const setupDropdownFilter = (input, optionsContainer, displayFn, clearBtn, asyncLookup) => {
        if (input) {
            input.oninput = evt => {
                const val = sanitizeInput(evt.target.value);
                displayFn(val);
                if (optionsContainer) optionsContainer.style.display = 'block';
                toggleClearIcon(input, clearBtn);
                asyncLookup?.(val);
            };
            input.onfocus = evt => {
                const val = evt.target.value;
                displayFn(val);
                if (optionsContainer) optionsContainer.style.display = 'block';
            };

            input.onkeydown = evt => {
                const options = optionsContainer?.querySelectorAll('.option');
                if (!options || options.length === 0) return;

                let current = optionsContainer.querySelector('.option.highlighted');
                let index = current ? parseInt(current.dataset.index) : -1;

                if (evt.key === 'ArrowDown') {
                    evt.preventDefault();
                    if (index < options.length - 1) index++;
                } else if (evt.key === 'ArrowUp') {
                    evt.preventDefault();
                    if (index > 0) index--;
                } else if (evt.key === 'Enter') {
                    evt.preventDefault();
                    if (current) selectOption(current, input.id, optionsContainer);
                    return;
                }

                options.forEach(o => o.classList.remove('highlighted'));
                if (index >= 0 && index < options.length) {
                    options[index].classList.add('highlighted');
                    options[index].scrollIntoView({ block: 'nearest' });
                }
            };
        }
    };

    // Attach with async lookup
    setupDropdownFilter(dom.spaceFilterInput, dom.spaceOptionsContainer, displayFilteredSpaceOptionsUI, dom.spaceClear, runSpaceLookup);
    setupDropdownFilter(dom.contributorFilterInput, dom.contributorOptionsContainer, displayFilteredContributorOptionsUI, dom.contributorClear, runUserLookup);

    if (dom.spaceClear) dom.spaceClear.onclick = clearSpaceFilter;
    if (dom.contributorClear) dom.contributorClear.onclick = clearContributorFilter;

    document.onclick = evt => {
        if (dom.spaceOptionsContainer && !evt.target.closest('#space-filter-container')) dom.spaceOptionsContainer.style.display = 'none';
        if (dom.contributorOptionsContainer && !evt.target.closest('#contributor-filter-container')) dom.contributorOptionsContainer.style.display = 'none';
    };
}
