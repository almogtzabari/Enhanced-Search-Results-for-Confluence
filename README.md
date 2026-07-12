<p align="center">
  <img src="assets/logo.png" alt="Enhanced Confluence Search Logo" height="100">
</p>

# Enhanced Search Results for Confluence Extension

Enhance your Confluence experience with improved search functionality. This browser extension upgrades Confluence search results with richer navigation, filtering, and AI-assisted workflows on both Chrome and Firefox.

## Features

### 🧠 AI-Powered Features

- **Instant Page Summaries**  
  Get a quick overview of any Confluence page with one click. A floating "Summarize" button appears on supported pages to help you understand content faster — no need to scroll or skim.

- **Ask Follow-Up Questions**  
  Not sure about something? Use the built-in Q&A to ask questions about the page and get instant answers. Perfect for clarifying technical details, exploring related topics, or saving time.

- **Remembers Your Conversations**  
  The extension remembers your previous questions for each page, so you can pick up right where you left off.

- **Customizable AI Behavior**  
  Want the AI to focus on specific things? You can add a custom prompt in the options page to tailor summaries to your needs.

### 🔍 Views and Navigation

- **Tree View Navigation**:
  - Displays search results in a hierarchical tree structure reflecting parent-child page relationships.
  - Tooltips show title, type, contributor, and last modified date on hover.
  - Toggle collapse/expand of the entire tree by re-pressing the Tree button.
  - Refined tree visuals for better readability.

- **Table View with Sorting and Resizing**:
  - Clean and modernized table view with alternating row styles.
  - Sortable columns by clicking the header (Type, Name, Space, Contributor, Created/Modified dates).
  - Columns are resizable; double-click the resizer to reset to default width.

- **Saved Searches**:
  - Save the current query + filters with a custom name.
  - Load, rename, delete, or clear saved searches from the sidebar.

### 🧰 Filtering and Search Options

- **Advanced Filtering**:
  - **Text Filtering**: Narrow results by keywords in title or content.
  - **Space Filtering**: Filter by Confluence spaces.
  - **Contributor Filtering**: Filter by page contributors.
  - **Date Filtering**: Filter by last modified time (past day/week/month/year).
  - **Type Filtering**: Filter by type (Page, Blog Post, Attachment, Comment).

- **Batch Size Control**:
  - Configure how many results are fetched per scroll batch.

### 🌙 Display and Personalization

- **Dark Mode + Confluence Theme Matching**: Use dark mode on extension pages while the AI modal opened inside Confluence automatically follows Confluence's light or dark theme. Theme matching is enabled by default and can be disabled to use the extension theme instead.
- **Customizable Domains**: Configure multiple Confluence domains from the Options page.
- **View-Specific Controls**: Independently toggle tree tooltips, table tooltips, and tree result-row highlighting.
- **New Icons and Branding**: Refreshed extension logo and interface icons for a polished experience.

### ⚡️ Performance & UX

- **Infinite Scrolling**: Automatically loads more results while scrolling.
- **Scroll-to-Top Button**: Instantly jump to the top of the results page.
- **Improved Runtime Performance** across both views.

## Installation

The extension is available on the Chrome Web Store and Firefox Add-ons site:

- <img src="assets/images/chrome.png" width="20" alt="Chrome" align="absmiddle"> **[Chrome Web Store](https://chromewebstore.google.com/detail/enhanced-search-results-f/mmaihfkphcnjjheipeljfjbfkimfhcch)**
- <img src="assets/images/firefox.png" width="20" alt="Firefox" align="absmiddle"> **[Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/enhanced-confluence-search/)**

## Development

For full development/build/test docs, including live Confluence smoke-test setup, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

Quickstart:

```bash
npm --prefix ui install
npm run test:ui
npm run lint
npm run build:dist:checked
```

## Usage

1. **Configure the Extension**:
   - Click the extension icon → **Options**
   - Add one or more Confluence domains
   - Click **Save Domain Settings** and approve the browser permission prompt for those domains
   - To enable AI-powered features:
     - Paste your **OpenAI API key** in the relevant field
     - (Optional) Provide a custom API endpoint if you're using a proxy or self-hosted service  
       Default base URL: `https://api.openai.com/v1` (the extension appends `/responses`)
     - On first AI use, approve the endpoint-domain permission prompt if requested

     <img src="assets/images/settings.png" alt="Settings Page" style="max-width: 800px; width: 100%;">

2. **Search in Confluence**:
   - Open any configured Confluence domain
   - Use the floating extension launcher to open enhanced search, summarize current content, or open settings
   - Enter your query in the enhanced search page to fetch Confluence results

3. **Browse and Filter**:
   - Use Tree or Table view
   - Apply filters as needed (spaces, contributors, date, type)
   - Use the search bar to refine your query further

     <img src="assets/images/tree-view.png" alt="Tree View" style="max-width: 800px; width: 100%;">
     <img src="assets/images/table-view.png" alt="Table View" style="max-width: 800px; width: 100%;">

## Configuration

### Domain Settings

Add one or more Confluence domains via the Options page (for example, `confluence.example.com`).

### Permissions

- Domain entries use optional host permissions. The browser prompts you when saving domains.
- AI requests use an endpoint-origin permission (`https://.../*`) for the configured OpenAI-compatible API base URL.
  - In both Chrome and Firefox, grant this from **Options → AI Options → Grant Endpoint Permission** (especially after changing the endpoint URL).
  - Firefox enforces stricter user-gesture rules for permission requests, so granting from the Options button is the reliable path.

### Advanced Options

- **Results per Batch**: Configure how many results are loaded at once to balance performance and speed.
- **Dark Mode + Confluence Theme Matching**: Toggle the extension theme independently. The Confluence-page AI modal follows the host page theme by default; disable **Match Confluence theme in page modal** to use the extension theme instead.
- **Tooltips and Row Highlighting**: Enable/disable tree tooltips, table tooltips, and tree result-row highlighting.
- **AI Feature Toggles**: Independently enable AI actions in enhanced results and floating summarize actions on Confluence pages.
- **AI Settings**: Configure model, reasoning effort, API key, custom endpoint base URL, and custom summarization prompt.
  - GPT-5.6 options include **Terra** for balanced everyday work, **Sol** as the flagship model, and **Luna** for the fastest responses.
  - **GPT-5.6 Terra** is selected when no model preference has been saved. Existing saved model selections are preserved.
  - OpenAI API key is stored in extension local storage (not browser sync storage).
  - The extension appends `/responses` to the configured endpoint base URL.
- **Cached Data Controls**: Clear all summaries + conversations, or clear only follow-up conversations.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution workflow and smoke-test checklist.

## License

This project is licensed under the [MIT License](LICENSE).

## Acknowledgements

- Built during the **ImpactOn Hackathon** in Ra'anana, Israel.
- Created to simplify and enhance navigation within Confluence search.
- Thanks to all contributors and the open-source community!

---

*Disclaimer: This extension is not affiliated with Atlassian or Confluence. It is an independent project intended to improve usability.*
