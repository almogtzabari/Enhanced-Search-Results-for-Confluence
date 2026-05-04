const SAFE_HTML_TAGS = new Set([
  'a', 'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'div', 'span', 'hr',
]);

const SAFE_HTML_ATTRS = new Set([
  'href', 'target', 'rel', 'title',
  'colspan', 'rowspan', 'scope',
  'dir', 'lang',
  'aria-label', 'aria-hidden',
]);

function isSafeHtmlUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('#') || trimmed.startsWith('/')) return true;
  return /^(https?:|mailto:|tel:)/i.test(trimmed);
}

export function sanitizeHtmlFragment(html = '') {
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button,textarea,select,svg,math').forEach((el) => el.remove());
  const nodes = [...doc.body.querySelectorAll('*')];
  nodes.forEach((el) => {
    const tag = el.tagName.toLowerCase();
    if (!SAFE_HTML_TAGS.has(tag)) {
      const parent = el.parentNode;
      if (parent) {
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
      }
      el.remove();
      return;
    }

    [...el.attributes].forEach((attr) => {
      const n = attr.name.toLowerCase();
      const v = attr.value || '';
      const allowedAttr = SAFE_HTML_ATTRS.has(n) || n.startsWith('data-');
      if (!allowedAttr || n.startsWith('on') || n === 'style' || n === 'srcset') {
        el.removeAttribute(attr.name);
        return;
      }

      if ((n === 'href' || n === 'src' || n === 'xlink:href') && (!isSafeHtmlUrl(v) || /^\s*(javascript:|data:)/i.test(v))) {
        el.removeAttribute(attr.name);
      }
    });

    if (tag === 'a') {
      const href = el.getAttribute('href');
      if (!href) {
        el.removeAttribute('target');
        el.removeAttribute('rel');
        return;
      }
      if (!el.getAttribute('target')) {
        el.setAttribute('target', '_blank');
      }
      const relValues = new Set((el.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
      relValues.add('noopener');
      relValues.add('noreferrer');
      el.setAttribute('rel', [...relValues].join(' '));
    }

    if (tag === 'pre' || tag === 'code') {
      el.setAttribute('dir', 'ltr');
    }
  });
  return doc.body.innerHTML;
}
