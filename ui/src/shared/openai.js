export function normalizeResponsesUrl(apiUrl) {
  let sanitizedBase = (apiUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  sanitizedBase = sanitizedBase.replace(/\/chat\/completions$/i, '');
  return /\/responses$/i.test(sanitizedBase) ? sanitizedBase : `${sanitizedBase}/responses`;
}
