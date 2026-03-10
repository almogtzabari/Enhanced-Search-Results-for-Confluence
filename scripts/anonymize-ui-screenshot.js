/**
 * UI Screenshot Anonymizer (copy/paste into browser console)
 *
 * Usage:
 * 1. Open the extension views page in the browser.
 * 2. Paste this entire file into DevTools Console and run.
 * 3. Take screenshots (tree/table/domain/avatars are anonymized).
 * 4. Restore original UI with: window.__esrMask.restore()
 */
(() => {
  const KEY = '__esrMask';
  if (window[KEY]?.enabled) {
    console.info('[mask] already enabled. Use window.__esrMask.restore() to undo.');
    return;
  }

  const cfg = {
    domain: 'confluence.example.com',
    tableResultPrefix: 'Dummy test result',
    treeResultPrefix: 'Dummy test result',
    treeParentPrefix: 'Dummy parent',
    spaceName: 'Dummy Space',
    contributorName: 'Dummy Contributor',
  };

  const svgDataUrl = (inner) =>
    `data:image/svg+xml;utf8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${inner}</svg>`,
    )}`;

  const DUMMY_USER_IMG = svgDataUrl(`
    <rect width="64" height="64" rx="12" fill="#eef2f7"/>
    <circle cx="32" cy="24" r="12" fill="#9aa7b8"/>
    <path d="M12 56c2-12 11-18 20-18s18 6 20 18" fill="#9aa7b8"/>
  `);

  const DUMMY_SPACE_IMG = svgDataUrl(`
    <rect width="64" height="64" rx="12" fill="#eef2f7"/>
    <path d="M10 20h16l5 6h23v22a6 6 0 0 1-6 6H16a6 6 0 0 1-6-6V20z" fill="#8fb6e8"/>
    <rect x="10" y="24" width="44" height="6" fill="#78a3da"/>
  `);

  const originals = new Map();
  const remember = (el, key, getter) => {
    if (!el) return;
    let rec = originals.get(el);
    if (!rec) {
      rec = {};
      originals.set(el, rec);
    }
    if (!(key in rec)) rec[key] = getter();
  };

  const setText = (el, text) => {
    if (!el) return;
    remember(el, 'text', () => el.textContent);
    el.textContent = text;
  };

  const setValue = (el, value) => {
    if (!el) return;
    remember(el, 'value', () => el.value);
    el.value = value;
  };

  const setAttr = (el, name, value) => {
    if (!el) return;
    const key = `attr:${name}`;
    remember(el, key, () => el.getAttribute(name));
    if (value == null) el.removeAttribute(name);
    else el.setAttribute(name, value);
  };

  const maskLink = (a, text) => {
    if (!a) return;
    setText(a, text);
    setAttr(a, 'title', text);
    setAttr(a, 'href', '#');
  };

  const maskImage = (img, src) => {
    if (!img) return;
    setAttr(img, 'src', src);
    setAttr(img, 'srcset', '');
  };

  const maskTopDomain = () => {
    const h1 = document.querySelector('.brand-wrap h1');
    setText(h1, cfg.domain);

    if (!window[KEY]._origTitle) window[KEY]._origTitle = document.title;
    if (/ on /i.test(document.title)) {
      document.title = document.title.replace(/ on .+$/i, ` on ${cfg.domain}`);
    } else if (/Enhanced Search/i.test(document.title)) {
      document.title = `Enhanced Search on ${cfg.domain}`;
    }
  };

  const maskTable = () => {
    const rows = document.querySelectorAll('.results-table tbody tr');
    rows.forEach((tr, i) => {
      const idx = i + 1;
      const tds = tr.querySelectorAll('td');

      maskLink(tds[1]?.querySelector('a'), `${cfg.tableResultPrefix} ${idx}`);

      maskLink(tds[2]?.querySelector('a.table-entity-name'), cfg.spaceName);
      setText(tds[2]?.querySelector('.ai-chip-popover-name'), cfg.spaceName);

      maskLink(tds[3]?.querySelector('a.table-entity-name'), cfg.contributorName);
      setText(tds[3]?.querySelector('.ai-chip-popover-name'), cfg.contributorName);

      tds[2]
        ?.querySelectorAll('img.table-entity-avatar, img.ai-chip-popover-avatar')
        .forEach((img) => maskImage(img, DUMMY_SPACE_IMG));

      tds[3]
        ?.querySelectorAll('img.table-entity-avatar, img.ai-chip-popover-avatar')
        .forEach((img) => maskImage(img, DUMMY_USER_IMG));
    });
  };

  const maskTree = () => {
    let resultN = 1;
    let parentN = 1;

    document.querySelectorAll('.tree-list .tree-row').forEach((row) => {
      const isResult = row.classList.contains('tree-row-result');
      const link = row.querySelector('a.node-link');
      if (!link) return;

      const text = isResult
        ? `${cfg.treeResultPrefix} ${resultN++}`
        : `${cfg.treeParentPrefix} ${parentN++}`;

      maskLink(link, text);
    });
  };

  const maskTreeTooltip = () => {
    const tip = document.querySelector('.tree-tooltip-v2');
    if (!tip) return;

    maskLink(tip.querySelector('.tree-tooltip-v2-title'), `${cfg.treeResultPrefix}`);
    const vals = tip.querySelectorAll('.tree-tooltip-v2-value');
    setText(vals[0], cfg.contributorName);
    setText(vals[1], cfg.spaceName);

    maskImage(tip.querySelector('.tree-tooltip-avatar'), DUMMY_USER_IMG);
    maskImage(tip.querySelector('.tree-tooltip-space-mini'), DUMMY_SPACE_IMG);
  };

  const maskFilterUi = () => {
    setValue(document.querySelector('input[placeholder*="Filter spaces"]'), cfg.spaceName);
    setValue(document.querySelector('input[placeholder*="Filter contributors"]'), cfg.contributorName);

    document.querySelectorAll('.space-options .combo-option span')
      .forEach((el) => setText(el, cfg.spaceName));
    document.querySelectorAll('.space-options .combo-option img')
      .forEach((img) => maskImage(img, DUMMY_SPACE_IMG));

    document.querySelectorAll('.contributor-options .combo-option span')
      .forEach((el) => setText(el, cfg.contributorName));
    document.querySelectorAll('.contributor-options .combo-option img')
      .forEach((img) => maskImage(img, DUMMY_USER_IMG));

    const selected = document.querySelectorAll('.combo-input-wrap .selected-filter-icon');
    if (selected[0]) maskImage(selected[0], DUMMY_SPACE_IMG);
    if (selected[1]) maskImage(selected[1], DUMMY_USER_IMG);
  };

  const maskAiModalMeta = () => {
    maskLink(document.querySelector('.ai-modal-title a'), cfg.tableResultPrefix);
    document.querySelectorAll('.ai-chip-popover-name').forEach((el, idx) => {
      setText(el, idx % 2 === 0 ? cfg.spaceName : cfg.contributorName);
    });
    document.querySelectorAll('.ai-chip-avatar, .ai-chip-popover-avatar').forEach((img) => {
      const chip = img.closest('.ai-chip');
      const isSpace = chip && /Space:/i.test(chip.textContent || '');
      maskImage(img, isSpace ? DUMMY_SPACE_IMG : DUMMY_USER_IMG);
    });
  };

  const applyMask = () => {
    maskTopDomain();
    maskTable();
    maskTree();
    maskTreeTooltip();
    maskFilterUi();
    maskAiModalMeta();
  };

  let applying = false;
  let raf = 0;

  const run = () => {
    if (applying) return;
    applying = true;
    try {
      applyMask();
    } finally {
      applying = false;
    }
  };

  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      run();
    });
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
  });

  window[KEY] = {
    enabled: true,
    _origTitle: null,
    apply: run,
    restore() {
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);

      for (const [el, rec] of originals.entries()) {
        for (const [k, v] of Object.entries(rec)) {
          if (k === 'text') el.textContent = v;
          else if (k === 'value') el.value = v;
          else if (k.startsWith('attr:')) {
            const attr = k.slice(5);
            if (v == null) el.removeAttribute(attr);
            else el.setAttribute(attr, v);
          }
        }
      }

      if (window[KEY]._origTitle) document.title = window[KEY]._origTitle;
      originals.clear();
      delete window[KEY];
      console.info('[mask] restored');
    },
  };

  run();
  console.info('[mask] enabled');
})();
