// =========================================================
//                    CONSTANTS & GLOBALS
// =========================================================

// --- Configuration ---
export const DEBUG = false; // Toggle verbose DEBUG logging
export const USE_LOCAL_PROXY = false; // Use local proxy for OpenAI requests
export const DB_NAME = 'ConfluenceSummariesDB';
export const DB_VERSION = 3;
export const SUMMARY_STORE_NAME = 'summaries';
export const CONVERSATION_STORE_NAME = 'conversations';
export const SCROLL_THRESHOLD_PX = 5;
export let RESULTS_PER_REQUEST = 75; // Can be updated from storage

// --- Type Definitions ---
export const typeIcons = { page: '📘', blogpost: '📝', attachment: '📎', comment: '💬' };
export const typeLabels = { page: 'Page', blogpost: 'Blog Post', attachment: 'Attachment', comment: 'Comment' };
export const DEFAULT_COL_WIDTHS = [80, 320, 200, 160, 100, 100];

// --- AI Prompts ---
export const summarySystemPrompt = `
    You are a technical summarizer. Your task is to generate a concise, relevance-focused HTML summary of Confluence content.
    This will help users assess whether a document is worth opening.
    You are given:
    - Title
    - Raw HTML body (Confluence storage format)
    - Type: "page", "blogpost", "comment", or "attachment"
    - Space name (if available)
    - Parent title (if comment)
    - Optional user prompt (important!)

    Output only valid, clean and nicely formatted HTML (no Markdown or code blocks, and no \`\`\`html).
    Use this format (unless user prompt requests otherwise):

    1. <h3> What is this [content type] about?</h3> followed by a paragraph summarizing content, with context:
    - Page: "This page, from the [space_link] space, covers..."
    - Blog post: "...published in the [space_link] space..."
    - Comment: "...posted on the page titled _X_ in the [space_link] space..."
    - Attachment: "...uploaded to the [space_link] space..."
    Use [space_link] as: <b><a href='[space_url]' target='_blank'>[space]</a></b> if space_url is available, or <b>[space]</b> otherwise.
    For example, "This page, from the <b><a href="[space_url]">[space]</a></b> space, covers...".
    2. <h3> Main points</h3> followed by a <ul><li> list
    3. Keep tone concise, neutral, and useful.
    Avoid repeating title. Omit internal field names or Confluence-specific terms.
    Important: If a user prompt is provided, it must be addressed in the summary.
    Use it to focus the summary on what the user cares about.
`;
export const qaSystemPrompt = `
    You are a helpful AI assistant answering follow-up questions about a Confluence document and its summary.
    Respond clearly, accurately, and in plain text. Avoid reiterating the full summary format.
    Answer as a helpful peer who understands the document’s purpose and key details.
    Important: Output only valid, clean and nicely formatted HTML (no Markdown or code blocks, and no \`\`\`html)
`;

// --- Logging Utility ---
export const log = {
    debug: (...args) => DEBUG && console.debug('[DEBUG]', ...args),
    info: (...args) => console.info('[INFO]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
};

export function setResultsPerRequest(value) {
    RESULTS_PER_REQUEST = value;
}