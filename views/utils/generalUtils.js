// =========================================================
//                    GENERAL UTILITY FUNCTIONS
// =========================================================
import { log } from '../config.js';
import { baseUrl } from '../state.js';

export function debounce(fn, delay) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), delay);
    };
}

export function getQueryParams() {
    const params = {};
    const sp = new URLSearchParams(window.location.search);
    for (const [key, value] of sp.entries()) params[key] = value;
    log.debug('[Query] Params:', params);
    return params;
}

export function updateUrlParams(params) {
    const url = new URL(window.location.href);
    for (const key in params) {
        if (params[key]) url.searchParams.set(key, params[key]);
        else url.searchParams.delete(key);
    }
    history.replaceState(null, '', url.toString());
}

export function escapeHtml(text = '') {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#039;' };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

export function isValidInput(input) {
    const regex = /^[\p{L}\p{N}\s\-_.@"'()\/:&,\[\]{}]*$/u;
    return regex.test(input);
}

export function sanitizeInput(input) { return String(input).replace(/[^\p{L}\p{N}\s\-_.@"']/gu, ''); }

export function formatDate(dateString) {
    const date = new Date(dateString);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} at ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function sanitiseBaseUrl(raw) {
    try {
        const u = new URL(raw);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Invalid protocol');
        return u.origin;
    }
    catch (_) {
        log.error('Rejected baseUrl:', raw);
        return '';
    }
}

export function buildConfluenceUrl(path) {
    if (typeof path !== 'string' || path.startsWith('http:') || path.startsWith('https:') || path.includes('javascript:') || path.includes('data:')) return '#';
    try { return new URL(path, baseUrl).toString(); } catch (_) { return '#'; }
}

export function detectDirection(text = '') {
    const rtlChars = /[\u0590-\u05FF\u0600-\u06FF]/;
    return rtlChars.test(text) ? 'rtl' : 'ltr';
}

export function sanitizeHtmlWithDOM(htmlString = '') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    ['script', 'style', 'iframe'].forEach(tag => doc.querySelectorAll(tag).forEach(el => el.remove()));
    const walker = document.createTreeWalker(doc, NodeFilter.SHOW_COMMENT, null);
    let comment;
    while ((comment = walker.nextNode())) comment.parentNode.removeChild(comment);
    return doc.body.innerHTML;
}