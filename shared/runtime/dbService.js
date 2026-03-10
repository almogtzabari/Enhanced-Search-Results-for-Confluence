// Remote DB access via background script
import {
    CONVERSATION_STORE_NAME,
    SAVED_SEARCH_STORE_NAME,
    SUMMARY_STORE_NAME,
    log
} from '../extensionConfig.js';

function callDbAction(store, mode, op, payload = null) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ dbAction: true, store, mode, op, payload }, (response) => {
            if (chrome.runtime.lastError) {
                return reject(chrome.runtime.lastError.message);
            }
            if (!response?.success) {
                return reject(response?.error || 'Unknown DB error');
            }
            resolve(response.result);
        });
    });
}

export function getStoredSummary(contentId, baseUrl) {
    log.debug('[Remote DB] getStoredSummary', contentId, baseUrl);
    return callDbAction(SUMMARY_STORE_NAME, 'readonly', 'get', [contentId, baseUrl]);
}

export function storeSummary({ contentId, baseUrl, title, summaryHtml, userPrompt }) {
    const entry = { contentId, baseUrl, title, summaryHtml, userPrompt, timestamp: Date.now() };
    log.debug('[Remote DB] storeSummary', contentId);
    return callDbAction(SUMMARY_STORE_NAME, 'readwrite', 'put', entry);
}

export function getStoredConversation(contentId, baseUrl) {
    log.debug('[Remote DB] getStoredConversation', contentId);
    return callDbAction(CONVERSATION_STORE_NAME, 'readonly', 'get', [contentId, baseUrl]);
}

export function storeConversation(contentId, baseUrl, messages) {
    const entry = { contentId, baseUrl, messages, timestamp: Date.now() };
    log.debug('[Remote DB] storeConversation', contentId);
    return callDbAction(CONVERSATION_STORE_NAME, 'readwrite', 'put', entry);
}

export function getAllSavedSearches() {
    return callDbAction(SAVED_SEARCH_STORE_NAME, 'readonly', 'getAll');
}

export function storeSavedSearch(entry) {
    return callDbAction(SAVED_SEARCH_STORE_NAME, 'readwrite', 'put', entry);
}

export function deleteSavedSearch(id) {
    return callDbAction(SAVED_SEARCH_STORE_NAME, 'readwrite', 'delete', id);
}

export function clearAllSavedSearches() {
    return callDbAction(SAVED_SEARCH_STORE_NAME, 'readwrite', 'clear');
}

export function clearAllSummariesAndConversationsFromDB() {
    return Promise.all([
        callDbAction(SUMMARY_STORE_NAME, 'readwrite', 'clear'),
        callDbAction(CONVERSATION_STORE_NAME, 'readwrite', 'clear')
    ]).then(() => true).catch(() => false);
}
