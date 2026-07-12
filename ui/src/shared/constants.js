import {
  DB_NAME as SHARED_DB_NAME,
  DB_VERSION as SHARED_DB_VERSION,
  SUMMARY_STORE_NAME,
  CONVERSATION_STORE_NAME,
  SAVED_SEARCH_STORE_NAME,
} from '../../../shared/extensionConfig.js';

export const DEFAULT_AI_MODEL = 'gpt-5.5';
export const AI_MODAL_BOUNDS_MESSAGE = 'enhanced-ai-modal-bounds';

export const AI_MODEL_OPTIONS = [
  { value: 'gpt-5.5', label: 'gpt-5.5' },
  { value: 'gpt-5.4', label: 'gpt-5.4' },
  { value: 'gpt-5.4-pro', label: 'gpt-5.4-pro' },
  { value: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
  { value: 'gpt-5-codex', label: 'gpt-5-codex' },
  { value: 'gpt-5', label: 'gpt-5' },
  { value: 'gpt-5-pro', label: 'gpt-5-pro' },
  { value: 'gpt-5-mini', label: 'gpt-5-mini' },
  { value: 'gpt-5-nano', label: 'gpt-5-nano' },
];

export const retiredModelFallbacks = {
  'gpt-5.1': DEFAULT_AI_MODEL,
  'gpt-5.2': DEFAULT_AI_MODEL,
  'gpt-5-chat-latest': DEFAULT_AI_MODEL,
  'gpt-5.2-chat-latest': DEFAULT_AI_MODEL,
  'gpt-5.2-pro': DEFAULT_AI_MODEL,
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
