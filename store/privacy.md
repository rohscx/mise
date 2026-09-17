# Privacy practices

Mise fills reusable work prompts with browser context and copies reviewed plain text. Prompt content, source URLs, captured text and remembered inputs are processed on-device. Mise makes no network requests for content, analytics, error reports or model calls. It has no accounts, telemetry or remote code and does not operate a sync server.

## Local storage

Chrome's local extension storage holds your prompts, partials, site rules, per-prompt usage counts and last-used times, free inputs you choose to remember, known chat hostnames and source-strategy settings. Remembered values are saved only after a successful Copy. Turning remembering off removes that stored value; deleting a prompt removes its usage and remembered inputs.

Chrome's session extension storage holds the explicitly captured source URL, title and top-frame selection, source tab identifier, capture method and time. A captured link has a URL but no title or selection. The capture survives service-worker suspension and remains until replaced, explicitly cleared or session storage is cleared. It does not survive browser restart, extension reload or update. Optional last-non-chat mode also keeps tab activation metadata in session storage, removing entries when tabs close. This is session activation order, not Chrome's browsing-history database.

In-progress fills and tab-picker choices are transient. Clipboard text is read once only after an explicit Read clipboard action for a prompt that references it, with optional permission. It is held only for that fill, never remembered or exported, and discarded on cancellation or closing the surface. Mise does not poll the clipboard or read it on popup opening.

## Chrome settings sync

Sync is opt-in. When enabled, only the source-strategy setting is sent through Chrome's sync service. The prompt library, URLs, selections, clipboard text, usage records, remembered inputs and known chat hostnames are not synced by Mise.

## Clipboard, exports and chat providers

Copy writes the reviewed text to the OS clipboard. Other applications and people with access to the clipboard may read it. OS clipboard history or cloud sync may retain or transmit it independently of Mise.

Library exports are plain JSON containing prompts, partials and ordered site rules, including template defaults. They exclude usage records, remembered values, captures and settings. Anyone with access to an export can read its contents, and moving or sharing that file can expose internal text.

Pasting into a chat shares the text with that application's provider under its own policies. Mise does not send the chat message or call a model. These explicit external actions and Chrome settings sync are boundaries to local-only content handling.

## Access and safeguards

Default capture temporarily accesses the explicitly chosen tab's URL, title and top-frame selection. No broad host permissions or persistent content scripts are requested. Optional tabs access supports choosing open tabs and the last-non-chat source strategy; it does not grant arbitrary access to page contents. Restricted pages may not permit selection capture.

Templates, imports, URLs, selections and clipboard values are treated as plain text, not executable markup. Extension storage is restricted to trusted extension contexts. Mise does not log prompt bodies, URLs, free inputs or clipboard data in diagnostics. Local storage is not promised to be encrypted, and removing records is not a promise of secure deletion from the device, backups or clipboard history.

## Data use

Mise does not sell user data or transfer it except as required for the user-facing purposes described above. Data is not used for advertising, analytics, unrelated purposes, creditworthiness or lending decisions. Mise's use of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including its Limited Use requirements.

## Contact

Questions about these practices can be raised at https://github.com/rohscx/mise/issues. Do not include private prompt content in a public issue.
