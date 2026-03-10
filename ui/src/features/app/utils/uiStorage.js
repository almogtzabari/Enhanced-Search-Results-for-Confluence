import {
  DEFAULT_AI_CHAT_FONT_SIZE_PX,
  DEFAULT_AI_MODAL_HEIGHT_FALLBACK_PX,
  DEFAULT_AI_MODAL_HEIGHT_RATIO,
  DEFAULT_AI_MODAL_WIDTH_FALLBACK_PX,
  DEFAULT_AI_MODAL_WIDTH_RATIO,
  DEFAULT_AI_QUESTION_HEIGHT,
  DEFAULT_TABLE_COL_WIDTHS,
  MAX_AI_QUESTION_HEIGHT,
  MIN_AI_MODAL_HEIGHT,
  MIN_AI_MODAL_WIDTH,
  MIN_AI_QUESTION_HEIGHT,
  MIN_TABLE_COL_WIDTH,
} from '../constants.js';

export function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function loadStoredTableColWidths() {
  try {
    const raw = sessionStorage.getItem('v2TableColWidths');
    if (!raw) return { ...DEFAULT_TABLE_COL_WIDTHS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_TABLE_COL_WIDTHS };
    return {
      type: Math.max(MIN_TABLE_COL_WIDTH, Number(parsed.type) || DEFAULT_TABLE_COL_WIDTHS.type),
      name: Math.max(MIN_TABLE_COL_WIDTH, Number(parsed.name) || DEFAULT_TABLE_COL_WIDTHS.name),
      space: Math.max(MIN_TABLE_COL_WIDTH, Number(parsed.space) || DEFAULT_TABLE_COL_WIDTHS.space),
      contributor: Math.max(MIN_TABLE_COL_WIDTH, Number(parsed.contributor) || DEFAULT_TABLE_COL_WIDTHS.contributor),
      created: Math.max(MIN_TABLE_COL_WIDTH, Number(parsed.created) || DEFAULT_TABLE_COL_WIDTHS.created),
      modified: Math.max(MIN_TABLE_COL_WIDTH, Number(parsed.modified) || DEFAULT_TABLE_COL_WIDTHS.modified),
      ai: Math.max(MIN_TABLE_COL_WIDTH, Number(parsed.ai) || DEFAULT_TABLE_COL_WIDTHS.ai),
    };
  } catch {
    return { ...DEFAULT_TABLE_COL_WIDTHS };
  }
}

export function loadStoredAiQuestionHeight() {
  const saved = Number.parseInt(sessionStorage.getItem('aiQuestionInputHeight') || '', 10);
  if (!Number.isFinite(saved)) return DEFAULT_AI_QUESTION_HEIGHT;
  return Math.max(MIN_AI_QUESTION_HEIGHT, Math.min(MAX_AI_QUESTION_HEIGHT, saved));
}

export function getDefaultAiModalWidth() {
  const viewportWidth = typeof window === 'undefined'
    ? (DEFAULT_AI_MODAL_WIDTH_FALLBACK_PX / DEFAULT_AI_MODAL_WIDTH_RATIO)
    : window.innerWidth;
  const maxWidth = Math.max(MIN_AI_MODAL_WIDTH, viewportWidth - 24);
  return clampNumber(viewportWidth * DEFAULT_AI_MODAL_WIDTH_RATIO, MIN_AI_MODAL_WIDTH, maxWidth);
}

export function getDefaultAiModalHeight() {
  const viewportHeight = typeof window === 'undefined'
    ? (DEFAULT_AI_MODAL_HEIGHT_FALLBACK_PX / DEFAULT_AI_MODAL_HEIGHT_RATIO)
    : window.innerHeight;
  const maxHeight = Math.max(MIN_AI_MODAL_HEIGHT, viewportHeight - 32);
  return clampNumber(viewportHeight * DEFAULT_AI_MODAL_HEIGHT_RATIO, MIN_AI_MODAL_HEIGHT, maxHeight);
}

export function loadStoredAiFontSize(storageKey, fallback = DEFAULT_AI_CHAT_FONT_SIZE_PX, min, max) {
  const saved = Number.parseFloat(sessionStorage.getItem(storageKey) || '');
  if (!Number.isFinite(saved)) return fallback;
  return clampNumber(saved, min, max);
}
