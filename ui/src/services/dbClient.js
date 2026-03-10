import {
  CONVERSATION_STORE,
  SAVED_SEARCH_STORE,
  SUMMARY_STORE,
} from '../shared/constants.js';

function callDbAction(store, mode, op, payload = null) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ dbAction: true, store, mode, op, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || 'DB message failed'));
        return;
      }
      if (!response?.success) {
        reject(new Error(response?.error || 'Unknown DB error'));
        return;
      }
      resolve(response.result);
    });
  });
}

export function getAllSavedSearches() {
  return callDbAction(SAVED_SEARCH_STORE, 'readonly', 'getAll');
}

export function storeSavedSearch(entry) {
  return callDbAction(SAVED_SEARCH_STORE, 'readwrite', 'put', entry);
}

export function deleteSavedSearch(id) {
  return callDbAction(SAVED_SEARCH_STORE, 'readwrite', 'delete', id);
}

export function clearAllSavedSearches() {
  return callDbAction(SAVED_SEARCH_STORE, 'readwrite', 'clear');
}

export function getStoredSummary(contentId, baseUrl) {
  return callDbAction(SUMMARY_STORE, 'readonly', 'get', [contentId, baseUrl]);
}

export function storeSummary(entry) {
  return callDbAction(SUMMARY_STORE, 'readwrite', 'put', entry);
}

export function getStoredConversation(contentId, baseUrl) {
  return callDbAction(CONVERSATION_STORE, 'readonly', 'get', [contentId, baseUrl]);
}

export function storeConversation(contentId, baseUrl, messages) {
  return callDbAction(CONVERSATION_STORE, 'readwrite', 'put', {
    contentId,
    baseUrl,
    messages,
    timestamp: Date.now(),
  });
}
