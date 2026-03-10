import {
  DB_NAME as SHARED_DB_NAME,
  DB_VERSION as SHARED_DB_VERSION,
  SUMMARY_STORE_NAME,
  CONVERSATION_STORE_NAME,
  SAVED_SEARCH_STORE_NAME,
} from '../../../shared/extensionConfig.js';

export const DEFAULT_AI_MODEL = 'gpt-5.2-chat-latest';

export const AI_MODEL_OPTIONS = [
  { value: 'gpt-5', label: 'gpt-5' },
  { value: 'gpt-5.2-chat-latest', label: 'gpt-5.2-chat-latest' },
  { value: 'gpt-5-pro', label: 'gpt-5-pro' },
  { value: 'gpt-5.2-pro', label: 'gpt-5.2-pro' },
  { value: 'gpt-5.2', label: 'gpt-5.2' },
  { value: 'gpt-5.1', label: 'gpt-5.1' },
  { value: 'gpt-5-mini', label: 'gpt-5-mini' },
  { value: 'gpt-5-nano', label: 'gpt-5-nano' },
  { value: 'gpt-5-chat-latest', label: 'gpt-5-chat-latest' },
];

export const retiredModelFallbacks = {
  'gpt-4o': DEFAULT_AI_MODEL,
  'gpt-4.1': DEFAULT_AI_MODEL,
  'gpt-4.1-mini': DEFAULT_AI_MODEL,
  o3: DEFAULT_AI_MODEL,
  'o4-mini': DEFAULT_AI_MODEL,
};

export const DB_NAME = SHARED_DB_NAME;
export const DB_VERSION = SHARED_DB_VERSION;
export const SUMMARY_STORE = SUMMARY_STORE_NAME;
export const CONVERSATION_STORE = CONVERSATION_STORE_NAME;
export const SAVED_SEARCH_STORE = SAVED_SEARCH_STORE_NAME;
