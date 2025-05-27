// =========================================================
//                    IndexedDB FUNCTIONS
// =========================================================
import { log, DB_NAME, DB_VERSION, SUMMARY_STORE_NAME, CONVERSATION_STORE_NAME } from '../config.js';

export function openDb() {
    log.debug(`[DB] Attempting to open DB: ${DB_NAME}, Version: ${DB_VERSION}`);
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = (event) => {
            log.error('[DB] Open error:', event.target.error);
            reject(event.target.error);
        };
        request.onsuccess = (event) => {
            log.info('[DB] Connection opened successfully.', { version: event.target.result.version });
            resolve(event.target.result);
        };
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            log.info(`[DB] Upgrade needed from v${event.oldVersion} to v${DB_VERSION}. Current stores:`, Array.from(db.objectStoreNames));
            if (!db.objectStoreNames.contains(SUMMARY_STORE_NAME)) {
                log.info(`[DB] Creating object store: ${SUMMARY_STORE_NAME}`);
                db.createObjectStore(SUMMARY_STORE_NAME, { keyPath: ['contentId', 'baseUrl'] });
            } else {
                log.info(`[DB] Object store already exists: ${SUMMARY_STORE_NAME}`);
            }
            if (!db.objectStoreNames.contains(CONVERSATION_STORE_NAME)) {
                log.info(`[DB] Creating object store: ${CONVERSATION_STORE_NAME}`);
                db.createObjectStore(CONVERSATION_STORE_NAME, { keyPath: ['contentId', 'baseUrl'] });
            } else {
                log.info(`[DB] Object store already exists: ${CONVERSATION_STORE_NAME}`);
            }
            log.info('[DB] Upgrade complete. Stores after upgrade:', Array.from(db.objectStoreNames));
        };
    });
}

async function makeDbRequest(storeName, mode, operation, data = null) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        try {
            if (!db.objectStoreNames.contains(storeName)) {
                log.error(`[DB] Store not found for transaction: ${storeName}. Available stores:`, Array.from(db.objectStoreNames));
                reject(new DOMException(`Object store ${storeName} not found`, 'NotFoundError'));
                return;
            }
            const tx = db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);
            const request = data !== null ? store[operation](data) : store[operation]();
            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => {
                log.error(`[DB] ${operation} error on ${storeName}`, event.target.error);
                reject(event.target.error);
            };
        } catch (error) {
            log.error(`[DB] Transaction creation error on ${storeName}`, error);
            reject(error);
        }
    });
}

export async function getStoredSummary(contentId, storeBaseUrl) {
    log.debug('[DB] Fetching stored summary', { contentId, storeBaseUrl });
    try { return await makeDbRequest(SUMMARY_STORE_NAME, 'readonly', 'get', [contentId, storeBaseUrl]); }
    catch (e) {
        log.warn('[DB] Failed to get stored summary', e);
        return null;
    }
}

export async function storeSummary({ contentId, baseUrl: storeBaseUrl, title, summaryHtml, bodyHtml }) {
    const entry = { contentId, baseUrl: storeBaseUrl, title, summaryHtml, bodyHtml, timestamp: Date.now() };
    log.debug('[DB] Storing summary', { contentId, storeBaseUrl });
    try { await makeDbRequest(SUMMARY_STORE_NAME, 'readwrite', 'put', entry); }
    catch (e) { log.error('[DB] Failed to store summary', e); }
}

export async function getStoredConversation(contentId, storeBaseUrl) {
    log.debug('[DB] Fetching stored conversation', { contentId, storeBaseUrl });
    try { return await makeDbRequest(CONVERSATION_STORE_NAME, 'readonly', 'get', [contentId, storeBaseUrl]); }
    catch (e) {
        log.warn('[DB] Failed to get stored conversation', e);
        return null;
    }
}

export async function storeConversation(contentId, storeBaseUrl, messages) {
    const entry = { contentId, baseUrl: storeBaseUrl, messages, timestamp: Date.now() };
    log.debug('[DB] Storing conversation', { contentId, storeBaseUrl, count: messages.length });
    try { await makeDbRequest(CONVERSATION_STORE_NAME, 'readwrite', 'put', entry); }
    catch (e) { log.error('[DB] Failed to store conversation', e); }
}

export async function clearAllSummariesAndConversationsFromDB() {
    try {
        await makeDbRequest(SUMMARY_STORE_NAME, 'readwrite', 'clear');
        await makeDbRequest(CONVERSATION_STORE_NAME, 'readwrite', 'clear');
        log.info('[DB] All summaries and conversations cleared from IndexedDB.');
        return true;
    } catch (error) {
        log.error('[DB] Error clearing summaries and conversations:', error);
        return false;
    }
}