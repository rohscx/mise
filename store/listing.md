# Chrome Web Store listing

## Extension name

Mise

## Short description

Fill reusable work prompts with browser context and copy the finished text to paste into an AI chat.

Character count: **100** (including spaces and punctuation; maximum 132).

## Detailed description

Work prompts are often mostly fixed text. Only a URL changes, and that URL lives in a different tab from the chat window where the prompt belongs. Copying from a notepad means finding the prompt and replacing the URL by hand every time.

Mise keeps your reusable prompts in a local library. Capture the source tab, switch to your chat, choose a prompt, and review the filled text and its source URL. Copy the result, paste it into your chat, and send it yourself. Mise does not call a model or submit messages.

Templates can use the captured URL, title, selected text, and the current date. Site rules extract named values from URLs, such as a GitHub owner and repository. Free inputs let you supply the details that change each time. Shared partials keep standing instructions in one place. The library editor includes a live template preview and a URL tester for site rules.

Search your prompts from the toolbar popup, keyboard shortcut, or the mise address-bar keyword. Explicit capture is the default. If you enable the optional tabs permission, you can choose another open tab or use the last non-chat tab as the source. Clipboard input is read only when a prompt needs it and you explicitly request it.

Your library and remembered inputs stay in local extension storage. Mise makes no network requests and has no accounts or telemetry. Export and import your library as plain JSON. Optional Chrome settings sync sends only your source-strategy setting through Chrome. Copied text can be retained or synced by your OS clipboard; exports can be read by anyone with access to the file. Pasting into chat shares the text with that provider.

## Category

Productivity

The dashboard accepts one category; Productivity fits the single purpose better than Tools.

## Language

English (United States)

## Single purpose

Mise fills reusable work prompt templates with deliberately chosen browser context and copies the reviewed plain text for the user to paste into a chat.

## Required permission justifications

### `storage`

Stores the prompt library, usage counts, remembered free inputs, chat-host settings and source strategy locally, and captures and tab activation metadata in session storage. Opt-in Chrome sync stores only the strategy setting. Without it, the library cannot persist and cross-tab captures cannot survive service-worker suspension.

### `activeTab`

Temporarily accesses the tab the user explicitly captures to obtain its URL and title and, together with scripting, read its top-frame selection. Without it, explicit capture cannot access that page context. It does not grant general page access or access to arbitrary background tabs.

### `scripting`

Reads the top frame's selected text during an explicit capture using activeTab's temporary grant. Without it, selection-dependent prompts cannot obtain selected text. It is not used to read pages generally, and no persistent content script is installed.

### `contextMenus`

Offers explicit link capture in the browser context menu. Without it, users cannot capture a link target without opening it. Link capture records the target URL, not the containing page's title or selection.

### `clipboardWrite`

Writes the reviewed plain-text preview to the OS clipboard after the user chooses Copy in the extension document. Without it, the extension's clipboard delivery cannot reliably complete and the user must copy text manually.

## Optional permission justifications

### `clipboardRead`

Requested by the explicit Read clipboard action only when the expanded prompt references the clipboard variable. Reads plain text once for that fill. Without it, clipboard-dependent prompts cannot resolve that input. There is no background polling or read on popup opening; the value is neither remembered nor exported.

### `tabs`

Requested when the user enables the tab picker or last-non-chat source strategy. Reads other open tabs' URLs and titles and tracks session activation order for those strategies. Without it, Mise cannot discover those sources; explicit capture remains available. It grants no arbitrary page-DOM access, and background selection is unavailable.

## Host permission justification

None. The manifest requests no host permissions. Commands, the toolbar action and the omnibox keyword are declarations, not additional permissions.

## Remote code

No. All executable code and styles are included in the extension package. Templates and site rules are data processed locally; no code is fetched from a server.

## Data usage disclosures

Select Website content, Web history and User activity to disclose the local handling below. These selections do not indicate transmission to the developer.

Website content: captured titles and top-frame selections, prompt text, free inputs and explicitly requested clipboard text are handled locally to fill prompts.

Web history: source URLs and, with optional tabs permission, open-tab URLs and titles and session activation order are handled for source selection. Mise does not read Chrome's browsing-history database.

User activity: local per-prompt usage counts and last-used times rank prompts; tab activation metadata supports the optional last-non-chat strategy. These are not transmitted as analytics.

Mise does not specifically request personally identifiable information, health information, financial/payment information, authentication information, personal communications or location. User-supplied text may contain such information; it receives the same local handling. There is no developer-operated data collection endpoint. Only the source-strategy preference is sent through Chrome settings sync when enabled.

## Data usage certifications

I certify that user data is not sold or transferred to third parties outside the approved use cases.

I certify that user data is not used or transferred for purposes unrelated to Mise's single purpose.

I certify that user data is not used or transferred to determine creditworthiness or for lending purposes.

Mise does not transfer prompt content itself. The user controls clipboard copying, JSON exports and pasting into another application; Chrome handles opted-in strategy sync.

## Privacy policy URL

https://github.com/rohscx/mise/blob/main/store/privacy.md

## Homepage URL

https://github.com/rohscx/mise

## Support URL

https://github.com/rohscx/mise/issues

## Store icon

Upload dist/icons/icon-128.png.

## Screenshots

Upload store/screenshots/popup.png, store/screenshots/prompt-editor.png and store/screenshots/site-rule.png in that order. Each is 1280 × 800 pixels and shows the built extension.

## Promotional video

Leave blank (optional).

## Small promotional tile

440 × 280 PNG or JPEG: still required before submission; not generated by this screenshot script.

## Marquee promotional tile

Leave blank (optional).

## Official URL

Leave blank unless the publisher has a verified site to select.

## Mature content

No.

## Distribution

Proposed submission settings: free, public, all available regions. The publisher must choose these settings in the dashboard.

## Reviewer test instructions

No account or credentials are needed. Open Mise's options, create a prompt containing {{url}}, and save it. Visit https://github.com/microsoft/TypeScript, open the toolbar popup and choose Capture current tab. Select the prompt, inspect its source URL and preview, then choose Copy. Paste into a text editor to inspect the result. Optional tab and clipboard permissions are requested only from their explicit controls.

## Publisher account fields

Use the existing publisher's verified contact email and account declarations. Those account-only values are not stored in this repository.
