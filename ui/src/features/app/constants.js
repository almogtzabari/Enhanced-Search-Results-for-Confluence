export const typeIcons = {
  page: '📄',
  blogpost: '📰',
  attachment: '📎',
  comment: '💬',
};

export const typeLabels = {
  page: 'Page',
  blogpost: 'Blog post',
  attachment: 'Attachment',
  comment: 'Comment',
};

export const DEFAULT_AI_MODAL_WIDTH_RATIO = 0.76;
export const DEFAULT_AI_MODAL_WIDTH_FALLBACK_PX = 1120;
export const MIN_AI_MODAL_WIDTH = 640;
export const DEFAULT_AI_MODAL_HEIGHT_RATIO = 0.7;
export const DEFAULT_AI_MODAL_HEIGHT_FALLBACK_PX = 760;
export const MIN_AI_MODAL_HEIGHT = 480;
export const DEFAULT_AI_SUMMARY_PANE_RATIO = 0.4;
export const MIN_AI_SUMMARY_PANE_RATIO = 0.24;
export const MAX_AI_SUMMARY_PANE_RATIO = 0.72;
export const DEFAULT_AI_QUESTION_HEIGHT = 96;
export const MIN_AI_QUESTION_HEIGHT = 70;
export const MAX_AI_QUESTION_HEIGHT = 260;
export const DEFAULT_AI_SUMMARY_FONT_SIZE_PX = 16;
export const MIN_AI_SUMMARY_FONT_SIZE_PX = 10;
export const MAX_AI_SUMMARY_FONT_SIZE_PX = 30;
export const DEFAULT_AI_CHAT_FONT_SIZE_PX = 14.4;
export const MIN_AI_CHAT_FONT_SIZE_PX = 10;
export const MAX_AI_CHAT_FONT_SIZE_PX = 28;
export const AI_FONT_SIZE_STEP_PX = 1;
// Responses with high reasoning effort or extensive output can legitimately
// take several minutes. The runtime port keeps both Chromium MV3 workers and
// Firefox MV2 background pages alive while the request is in flight.
export const OPENAI_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
export const MIN_TABLE_COL_WIDTH = 70;

export const DEFAULT_TABLE_COL_WIDTHS = {
  type: 72,
  name: 440,
  space: 240,
  contributor: 240,
  created: 180,
  modified: 180,
  ai: 116,
};

export const TABLE_SORTABLE_COLUMNS = new Set([
  'type',
  'name',
  'space',
  'contributor',
  'created',
  'modified',
]);

export const summarySystemPrompt = `
You are a technical summarizer. Generate concise, relevant HTML summary for Confluence content.
Use:
1. <h3>What is this about?</h3> and one short paragraph.
2. <h3>Main points</h3> and a short <ul><li> list.
Formatting:
- Output valid clean HTML only (no markdown, no code fences).
- Never use markdown-style inline code markers.
- Wrap technical identifiers in <code>...</code> where relevant:
  constants, commands, APIs, interfaces, endpoints, config keys, class/module/file names.
- Use <strong>...</strong> only for short emphasis labels.
`;

export const qaSystemPrompt = `
You answer follow-up questions about a Confluence document.
Respond clearly and use valid clean HTML only (no markdown or code fences).
Formatting:
- Never use markdown-style inline code markers.
- Use <code>...</code> for technical terms and identifiers where relevant.
- Use <strong>...</strong> sparingly for short labels/emphasis.
`;

export const fallbackSpaceIcon = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="2.5" y="4" width="19" height="16" rx="3" fill="#e8f1ff" stroke="#4f8ff5"/><path d="M3.8 9h16.4" stroke="#4f8ff5" stroke-width="1.4"/><path d="M8 3v3M16 3v3" stroke="#4f8ff5" stroke-width="1.6" stroke-linecap="round"/></svg>',
)}`;

export const fallbackUserIcon = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#eaf2ff" stroke="#7aa6e8"/><circle cx="12" cy="9" r="3" fill="#7aa6e8"/><path d="M6.2 17.4a5.8 5.8 0 0 1 11.6 0" fill="#7aa6e8"/></svg>',
)}`;
