export const DEBUG = false;

export const DB_NAME = 'ConfluenceSummariesDB';
export const DB_VERSION = 5;
export const SUMMARY_STORE_NAME = 'summaries';
export const CONVERSATION_STORE_NAME = 'conversations';
export const SAVED_SEARCH_STORE_NAME = 'saved_searches';

export const log = {
  debug: (...args) => DEBUG && console.debug('[DEBUG]', ...args),
  info: (...args) => console.info('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
};
