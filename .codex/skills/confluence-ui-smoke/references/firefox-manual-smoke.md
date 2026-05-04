# Firefox Manual Smoke

Firefox automation is intentionally manual for this skill version because the project builds Firefox as MV2 and loads it through `about:debugging`.

1. Run `npm run build:dist:checked`.
2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
3. Click "Load Temporary Add-on" and select `dist/firefox/manifest.json`.
4. Open the extension options page.
5. Add the Confluence domain from `.codex/confluence-smoke.env`.
6. Set the OpenAI API key and custom API base URL from `.codex/confluence-smoke.env`.
7. Save settings and approve the Confluence and endpoint permissions.
8. Open the configured Confluence page and confirm the floating launcher appears.
9. Open enhanced search from the launcher, run `CONFLUENCE_SEARCH_QUERY`, and switch tree/table views.
10. Open the AI modal from search results, generate a summary, and ask a follow-up question.
11. Return to the Confluence page, open the floating summarize modal, generate a summary, ask a follow-up question, and close the iframe modal.
