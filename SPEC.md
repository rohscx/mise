# 1. Summary

Mise (from mise en place: everything prepped before the work starts) is the product name.

Mise is a Manifest V3 Chrome extension for reusable work prompts. It fills templates from browser context, previews the result, and copies plain text.
The primary workflow captures a ticket in one tab and prepares a prompt in another. Reusable partials hold standing instructions without duplicating them in each prompt.
Version 0.1 is a local library with explicit capture as its default context source. No model invocation, remote prompt service, or automatic chat submission is involved.
The one-keystroke destination is a later insertion-adapter goal; MVP still requires paste. This document is normative except for the explicitly identified open questions.

# 2. Problem statement and today's workflow

The user keeps work prompts in a notepad dock beside their browser. They copy a prompt, replace its trailing internal ticket URL, and paste into agent chat.
The source ticket and the Ona / Gitpod chat pane occupy different browser tabs. Using whichever tab is current at fill time can accidentally supply the chat URL.
Most text is stable: skills instructions, Scout delegation, and a stop-before-commit rule. Those rules must remain byte-for-byte reusable while ticket-specific text changes.

Today's steps are: locate prompt, copy, edit URL, switch tab, paste, inspect, submit. The intended steps are: capture ticket, switch tab, choose prompt, preview, copy, paste.
Mise never presses the chat application's send button.

The source ticket used throughout this specification is:

```text
https://jira.example.com/projects/OPS/queues/custom/43/OPS-4821
```

The host identifies the service; `OPS` is the project and `OPS-4821` is the issue. The same workflow must support WEB and SEC projects without changing the template.

# 3. Goals / Non-goals

| Goal | Required result |
| --- | --- |
| Replace the notepad dock | Create, edit, delete, find, and fill prompts locally. |
| Keep standing rules consistent | Include named partials, including nested partials. |
| Resolve cross-tab context safely | Show the exact source URL before every copy. |
| Minimize repetitive typing | Derive URL fields and remember opted-in free values. |
| Work across chat applications | Use plain-text clipboard delivery in MVP. |
| Preserve portability | Export and import one documented JSON library format. |

| Non-goal | Why excluded |
| --- | --- |
| Prompt chaining or pipelines | Adds execution state beyond filling one text template. |
| Direct model API calls | Adds credentials, costs, and model execution responsibilities. |
| Hosted sync backend or accounts | Adds infrastructure and custody of internal work text. |
| Team sharing beyond JSON files | Permissions, collaboration, and conflict resolution are out of scope. |
| Automatic chat submission | The user must review and send the prepared request themselves. |

# 4. Core concepts and data model

The following types define persisted library records and runtime context separately. (`PromptPartial` replaces `Partial` to avoid shadowing TypeScript’s `Partial<T>` utility; the wire format is unchanged.) All strings are Unicode; bodies retain their line breaks and have no implicit trimming.
Timestamps use UTC RFC 3339 strings; URL values use the browser's absolute serialization. IDs and partial names use `[a-z][a-z0-9-]{0,63}` and remain stable across exports.
Free variable names use `[A-Za-z_][A-Za-z0-9_]{0,63}`. Every field is required unless marked optional; unknown persisted fields are rejected.

```typescript
type UrlMatchPattern = string;
type ContextName = "url" | "title" | "selection" | "date" | "clipboard";
type ContextStrategy = "capture" | "last-non-chat" | "tab-picker";
interface FreeVariable {
  kind: "free";
  name: string;
  label: string;
  defaultValue: string;
  rememberLast: boolean;
}
type Variable =
  | { kind: "context"; name: ContextName; value: string | null }
  | { kind: "derived"; name: string; ruleId: string; value: string | null }
  | FreeVariable;
interface Prompt {
  id: string;
  name: string;
  body: string;
  tags: string[];
  scope: UrlMatchPattern[];
  variables: FreeVariable[];
}
interface PromptPartial {
  name: string;
  body: string;
}
interface SiteRule {
  id: string;
  match: UrlMatchPattern;
  regex: string;
  flags: "" | "i";
}
interface CaptureSlot {
  url: string;
  title: string | null;
  selection: string | null;
  sourceTabId: number | null;
  source: "tab" | "link";
  capturedAt: string;
}
interface FillContext {
  strategy: ContextStrategy;
  source: CaptureSlot;
  date: string;
  clipboard: string | null;
}
interface Usage {
  count: number;
  lastUsedAt: string | null;
}
interface LocalState {
  library: ExportFile;
  usage: Record<string, Usage>;
  remembered: Record<string, Record<string, string>>;
  knownChatHosts: string[];
  strategy: ContextStrategy;
}
interface ExportFile {
  schemaVersion: 1;
  prompts: Prompt[];
  partials: PromptPartial[];
  siteRules: SiteRule[];
}
```

`Prompt.variables` declares only free inputs; context and captures are not declarations. A partial may reference any variable but declares none; the consuming prompt owns inputs.
`remembered` is keyed by prompt ID, then variable name, and is never exported. `usage` is keyed by prompt ID and changes only after successful clipboard delivery.
Deleting a prompt removes its usage and remembered values. Deleting or renaming a referenced partial is blocked until references are updated.
Capture slots and in-progress fills are transient, not part of `LocalState` or export.

# 5. Template language

| Syntax | Meaning |
| --- | --- |
| `{{url}}` | Interpolate a variable as plain text. |
| `{{> house-rules}}` | Include a partial by its exact, case-sensitive name. |
| `{{url.host}}` | Source URL hostname, excluding port. |
| `{{url.path}}` | Source URL pathname, retaining percent encoding. |
| `{{url.param:NAME}}` | First decoded query parameter named NAME; case-sensitive. |
| `\{{` | Emit literal `{{`; the opening delimiter is not parsed. |
| `\\` | Emit one literal backslash. |

Whitespace around tokens is ignored; whitespace inside names is not allowed. Query parameter names in tokens use `[A-Za-z0-9_.~-]+`.
Other backslashes are literal; a trailing backslash is literal. Literal `}}` needs no escape outside a token.
There are no conditionals, loops, expressions, filters, executable functions, or HTML.

Resolution precedence is strict and applies to names, not to truthiness of values:

1. Context variables and the reserved `url.*` accessors.
2. Named captures from the first successful site rule.
3. Free variables declared by the selected prompt.

A missing context value does not fall through to a same-named free input. Reject free names or capture names colliding with reserved context names on save/import.
If a derived capture and a free declaration share a name, the capture wins when present. If no matching capture exists, that declaration supplies the free input.
An unmatched optional capture is unavailable, rather than the string `undefined`.

Fill steps are deterministic:

1. Snapshot the selected template, partials, rules, and source context.
2. Parse and expand partials depth-first, preserving surrounding text exactly.
3. Resolve context/accessor tokens and apply site-rule captures.
4. Collect remaining declared free inputs in their first appearance order, once each.
5. Show their form, render a plain-text preview, and require explicit Copy.

The prompt is depth 0; at most eight nested partial inclusions are allowed. Track the active partial-name stack: an include already on that stack is a cycle.
Repeated inclusion on separate branches is valid; cycle errors show the full chain. Substituted variable values are never parsed as templates or partials.
Escapes are recognized during parsing, not by reparsing expanded text. A filled output may not exceed 1 MiB of UTF-8 text; larger output blocks Copy.

| Situation | Behaviour |
| --- | --- |
| Unknown variable | Block Copy; show token and originating prompt/partial. |
| Missing partial, cycle, or depth overflow | Block Copy; show the inclusion path. |
| Unclosed delimiter or malformed token | Allow draft save; block Copy/import and show location. |
| Missing query parameter | Unresolved error; present-but-empty parameter resolves empty. |
| Selection unavailable | Unresolved error; a captured empty selection resolves empty. |
| Clipboard denied/unavailable | Block fill until explicit retry or cancellation. |
| Free input left empty | Valid explicit empty string; show it in the preview. |

Free fields initialize from remembered value, otherwise default, otherwise empty string. The declaration's `rememberLast` is visible and editable in the options page.
Remember values only after successful Copy; cancellation does not change them. Turning remembering off deletes the stored value immediately.
`date` is the fill's local calendar date, formatted `YYYY-MM-DD`, frozen for that fill. `clipboard` is read once on explicit request, before Copy can overwrite it.

# 6. Site rules and URL derivation

Rules use Chrome URL match-pattern syntax restricted to HTTP and HTTPS patterns. Reject `<all_urls>`, file schemes, and unsupported pattern syntax on save/import.
Scope matching and rule matching inspect the chosen URL without navigating or fetching it. The capture source drives derivation; the active chat tab never supplies derived values.
Evaluate rules in their stored array order; the first matching pattern and regex wins. A pattern match with no regex match proceeds to the next rule.
Do not merge captures across rules; order is the explicit conflict-resolution mechanism. Use ECMAScript regex syntax with named capture groups; only empty or `i` flags are allowed.

The concrete example Jira rules, in export order, are:
Add a new Jira URL shape as a new rule rather than editing a working rule.

```json
[
  {
    "id": "jira-queue",
    "match": "https://jira.example.com/*",
    "regex": "^https://jira\\.example\\.com/projects/(?<project>[A-Z][A-Z0-9]+)/queues/custom/[0-9]+/(?<ticket>\\k<project>-[0-9]+)(?:[/?#].*)?$",
    "flags": ""
  },
  {
    "id": "jira-browse",
    "match": "https://jira.example.com/*",
    "regex": "^https://jira\\.example\\.com/browse/(?<ticket>(?<project>[A-Z][A-Z0-9]+)-[0-9]+)(?:[/?#].*)?$",
    "flags": ""
  }
]
```

Both regexes run against the complete serialized URL without decoding the path first.
Project keys use `[A-Z][A-Z0-9]+`, covering OPS, WEB, SEC, and new projects such as PLAT.
The queue rule retains `\k<project>` so the issue prefix must agree with the path project.
The browse rule captures the project inside the ticket; there is no separate project to cross-check.
The section 2 queue URL and `https://jira.example.com/browse/OPS-4821` both yield `project` = `OPS` and `ticket` = `OPS-4821`.
`url.host` is `jira.example.com`; `url.path` retains the respective `/projects/...` or `/browse/OPS-4821` path.
With `?view=activity` appended, `url.param:view` is `activity`; `url` retains query and fragment.
A queue URL with `/projects/WEB/` but issue `OPS-4821` matches neither rule and yields no captures.

### Worked example 1: implement an internal ticket

The export decomposes the real prompt into `skills-preamble`, `review-before-commit`, and the nested `house-rules` wrapper; this prompt includes the first two directly. Its template body is:

```text
{{> skills-preamble}}

Use the relevant skill to complete this request:

Create a local branch.
Use Scout sub-agents to gather additional context from the provided path, linked
resources in the request body (including WEB, OPS, and SEC), and comments on the
included link.
Create a plan based on the collected context, then execute it.
{{> review-before-commit}}
{{url}}
```

With the example URL, the exact rendered body is:

```text
+ New skills have been loaded in this dir: ".agent/skills/"
+ Review at a high-level read and understand how each skill is used.
* Use skill first: commit-policy (Sub-agent: Scout).

Use the relevant skill to complete this request:

Create a local branch.
Use Scout sub-agents to gather additional context from the provided path, linked
resources in the request body (including WEB, OPS, and SEC), and comments on the
included link.
Create a plan based on the collected context, then execute it.
Stop after implementing the changes so I can review them before anything is
committed:
https://jira.example.com/projects/OPS/queues/custom/43/OPS-4821
```

No trailing newline is inserted; the result preserves the supplied prompt verbatim. Derived values remain available even though this particular body only needs `url`.
The extra ticket-summary prompt in the export demonstrates using both captures.

### Worked example 2: review a GitHub pull request

Scope is `https://github.com/*/*/pull/*`; free variable `focus` defaults to `correctness`. Its remembered value is local to this prompt; initial example value is `error handling`.
The template includes `review-only` and renders as follows for a sample PR:

```text
Review this pull request for error handling:
https://github.com/example/platform/pull/42
Report actionable findings with file and line references. Do not modify files.
```

Capture the PR, switch to chat, select the prompt, enter the focus, preview, then Copy. On a GitHub PR tab it sorts above unscoped prompts; in chat it remains searchable.
The export additionally contains ticket-summary and selection-explanation prompts.

# 7. Cross-tab context capture

A source URL and a paste destination are different concepts; never silently substitute.
Every preview shows the complete resolved URL in a selectable, wrapping source row.
That row also shows the source method and capture time, outside the copied body.
A source change invalidates derived values and rebuilds the preview before Copy.

| Strategy | Resolution | Availability |
| --- | --- | --- |
| Explicit capture | Read the staging slot, never silently use the active tab. | MVP default. |
| Last non-chat tab | Most recently activated eligible tab in normal windows. | MVP, optional `tabs`. |
| Explicit tab picker | User selects a currently open HTTP(S) tab. | MVP, optional `tabs`. |

Explicit capture snapshots URL, title, and top-frame selection on tab A.
It replaces a single profile-wide slot after an intentional Capture action.
The slot survives service-worker suspension and source-tab closure or navigation.
Store it in `chrome.storage.session`; it does not survive restart, reload, or update.
It remains until replaced, explicitly cleared, or session storage is cleared; no timer.
Display its age; an empty slot blocks fill and offers Capture or Choose tab.
Capturing a link stores its target URL, with null title and null selection.
Do not mislabel the containing page's title or selection as the link target's context.

Last-non-chat records activation order, not browser history, while permission is enabled.
Known chat hosts are exact lowercase hostnames entered in settings, without wildcards.
Start with an empty list and require configuration before enabling this strategy.
Exclude all configured hosts, extension pages, non-HTTP(S) tabs, and incognito tabs.
Persist activation metadata in session storage; remove entries when tabs close.
After restart, require an observed activation; do not invent an earlier visit order.
At fill time re-read the candidate's current URL/title and recheck host exclusions.
Selection is unavailable for background tabs without a fresh explicit capture.
The preview's one-click Choose tab control overrides the candidate for this fill.
No candidate or revoked permission produces an explicit source-selection error.

The tab picker lists permitted normal tabs with title and full URL, filtered by text.
It does not activate or navigate the chosen tab; it snapshots URL and title on selection.
Its selection value is null, so selection-dependent prompts require explicit capture.
Picker selection is fill-local and does not overwrite the staging slot.
The destination remains the user's chat tab; no strategy automatically sends text there.

# 8. Insertion into the chat window

MVP Copy writes only `text/plain` from the final preview using the extension UI.
On success show an extension-surface toast: “Copied. Paste into your chat.”
Only then update usage and opted-in remembered values; keep the preview available.
On failure show “Copy failed” and retain selectable text for manual copy and retry.
Clipboard delivery avoids editor-specific integration but is not infallible.
Browser policy, focus, or OS clipboard failures must never be reported as success.
The user focuses the chat editor and presses Ctrl+V or Command+V, then reviews and sends.
Clipboard access runs in a focused extension document, not the service worker.
See [clipboard constraints](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Interact_with_the_clipboard).

Later, a per-site adapter registry maps destination patterns to tested editor adapters.
Each adapter must identify the editor, insert at its selection, and verify resulting text.
Modern chat panes commonly use contenteditable ProseMirror or Lexical editors.
Assigning `.value` does not update those editors or their internal document state.
Adapters require the editor's supported insertion transaction or an `insertText` /
`beforeinput` path that actually updates state, with appropriate input notifications.
Dispatching synthetic events alone does not guarantee insertion; events may be untrusted.
Never claim success based only on event dispatch; verify through the adapter contract.
Unsupported editor, permission denial, or failed verification offers clipboard fallback.
Never repeat injection blindly after partial insertion; show the failure for user review.
Ona / Gitpod is the first target; its editor type and frame arrangement are unverified.
No adapter may click Send, execute prompt instructions, or navigate to the source URL.

# 9. User surfaces

### Popup

Click the toolbar action to open search with focus in the search field.
Show Capture current tab, the staged source, and prompt results immediately.
Fuzzy search covers names, raw bodies, recursively expanded partial text, and tags.
Use case-insensitive subsequence matching; every whitespace-separated query term must match.
For each term score each field: exact 4, prefix 3, substring 2, subsequence 1, absent 0.
Take the best field score per term and sum; empty queries score zero.
Sort matching candidates by active-tab scope match, score, last-used time, use count, name, ID.
More recent and more frequent sort first; unused times rank last; name/ID use code-point order.
Scope is a ranking hint, never an access control or a filter hiding other prompts.
Resolve scope against the active browser tab at invocation, independently of the capture slot.
If its URL is unavailable, apply no scope boost and keep search usable.
Select a result to open inputs and the filled preview; Copy is always explicit.
Options opens library editing, partial editing, rule ordering, settings, and import/export.

### Options page

A library list sits beside the selected prompt editor, with name, tags, and scope above the body.
A multiline body field occupies the main area; free-variable definitions sit below it.
Show inline diagnostics and a live preview alongside the body as the user types.
Validate syntax, unknown variables, missing partials, and inclusion cycles on each edit.
Diagnostics identify the token location or inclusion path, including errors in referenced partials.
Save draft preserves unfinished text despite these errors; Copy stays blocked until they are fixed.
Draft status is derived from validation, not a new field in the export schema.
Export requires those errors to be fixed so the resulting file passes the existing import checks.
The partial editor provides name and body fields with the same live diagnostics and draft saving.
Display each partial's reference count: distinct prompts or partials directly including it.
Revalidate affected consumers when a partial changes; retain the existing deletion/rename safeguards.
The site-rule list provides Move up and Move down controls, reflecting first-match-wins order.
Each rule editor accepts a pasted test URL and displays its named captures or an explicit no-match result.
Tests apply both the URL pattern and regex, and show validation errors or timeouts without navigating.

### Quick-open palette

A named `chrome.commands` global command opens or focuses a compact extension popup window.
It uses the same search/input/preview interface as the toolbar popup, without page injection.
Suggest Ctrl+Shift+1 where supported; expose shortcut conflicts and remapping instructions.
Global commands have platform restrictions; ChromeOS uses the browser-focused equivalent.
If Chrome was not focused, inspect its last-focused normal window, never another app.
See [commands and global scope](https://developer.chrome.com/docs/extensions/reference/api/commands).

| Step | Key or action | Result |
| --- | --- | --- |
| 1 | On tab A, toolbar action, then Capture current tab | Slot contains the source snapshot. |
| 2 | Switch to tab B using the browser's tab shortcut | Chat is the intended destination. |
| 3 | Press assigned global shortcut | Palette opens with search focused. |
| 4 | Type `implement` | Matching prompt becomes first result. |
| 5 | Down/Up if needed, then Enter | Select prompt and show inputs/preview. |
| 6 | Type free values; Tab between fields if present | Preview updates; source URL stays visible. |
| 7 | Tab to Copy, then Enter | Copy final preview and show success toast. |
| 8 | Escape; focus chat; Ctrl+V or Command+V | User pastes text for review. |

Escape closes the palette without copying; Enter in search never silently copies.
All controls have labels, visible focus, and keyboard reachability.

### Omnibox

Type `mise`, press Tab or Space, then type search words to see prompt suggestions.
Choose a suggestion and press Enter to open the same fill UI for its prompt ID.
Do not navigate the tab to a source URL or put prompt bodies into suggestion descriptions.
An unmatched query opens the palette with that query; empty input shows ranked prompts.
Omnibox invocation does not assume an `activeTab` grant: unavailable scope gets no boost.
Use the staging slot unless another strategy was explicitly selected.
See [omnibox keyword behaviour](https://developer.chrome.com/docs/extensions/reference/api/omnibox).

### Link context menu

Right-click an HTTP(S) link and choose “Capture link for Mise”.
Store its absolute target URL, not the containing tab URL; confirm with an action badge.
The next popup shows the captured link and timestamp; successful capture clears old metadata.
Non-HTTP(S) targets are rejected without replacing the slot.

# 10. Storage, sync and the export/import file format

`chrome.storage.local` is the store of record for the library and personal local settings.
Its quota is 10,485,760 bytes (10 MiB); `unlimitedStorage` can remove that quota later.
`chrome.storage.sync` allows 102,400 bytes total and 8,192 bytes per item.
A long prompt can exceed the per-item limit alone; the library must never be stored there.
Session storage holds captures and tab activity across service-worker suspension.
See [Chrome storage quotas and lifetime](https://developer.chrome.com/docs/extensions/reference/api/storage).
Settings sync is off by default; opt-in sync stores only the chosen strategy enum.
Chat hosts, bodies, scopes, rules, history, free values, and URLs always stay out of sync.
Local settings remain authoritative while sync is disabled; sync failure does not block fill.
Enabling sync publishes the local strategy; later received changes update its local mirror.
Turning sync off stops reads/writes; explain that it does not erase other devices' copies.
No sync setting grants an optional permission or bypasses local strategy prerequisites.

Exports contain exactly the four root fields below and UTF-8 JSON without a BOM.
The schema is JSON Schema Draft 2020-12; additional semantic checks follow it.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Mise export version 1",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "prompts", "partials", "siteRules"],
  "properties": {
    "schemaVersion": { "const": 1 },
    "prompts": { "type": "array", "items": { "$ref": "#/$defs/prompt" } },
    "partials": { "type": "array", "items": { "$ref": "#/$defs/partial" } },
    "siteRules": { "type": "array", "items": { "$ref": "#/$defs/rule" } }
  },
  "$defs": {
    "id": { "type": "string", "pattern": "^[a-z][a-z0-9-]{0,63}$" },
    "strings": { "type": "array", "uniqueItems": true, "items": { "type": "string" } },
    "variable": {
      "type": "object", "additionalProperties": false,
      "required": ["kind", "name", "label", "defaultValue", "rememberLast"],
      "properties": {
        "kind": { "const": "free" },
        "name": { "type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]{0,63}$" },
        "label": { "type": "string", "minLength": 1 },
        "defaultValue": { "type": "string" },
        "rememberLast": { "type": "boolean" }
      }
    },
    "prompt": {
      "type": "object", "additionalProperties": false,
      "required": ["id", "name", "body", "tags", "scope", "variables"],
      "properties": {
        "id": { "$ref": "#/$defs/id" },
        "name": { "type": "string", "minLength": 1 },
        "body": { "type": "string" },
        "tags": { "$ref": "#/$defs/strings" },
        "scope": { "$ref": "#/$defs/strings" },
        "variables": { "type": "array", "items": { "$ref": "#/$defs/variable" } }
      }
    },
    "partial": {
      "type": "object", "additionalProperties": false,
      "required": ["name", "body"],
      "properties": { "name": { "$ref": "#/$defs/id" }, "body": { "type": "string" } }
    },
    "rule": {
      "type": "object", "additionalProperties": false,
      "required": ["id", "match", "regex", "flags"],
      "properties": {
        "id": { "$ref": "#/$defs/id" },
        "match": { "type": "string", "minLength": 1 },
        "regex": { "type": "string", "minLength": 1, "maxLength": 4096 },
        "flags": { "enum": ["", "i"] }
      }
    }
  }
}
```

IDs are unique within each record type; partial names and per-prompt free names are unique.
Validate match patterns, compilable regexes, named capture identifiers, and reserved names.
Reject missing partials, cycles, excess depth, and invalid template syntax before import.
A variable supplied by a rule is valid statically but can still be unresolved at fill time.
Reject tokens not supplied by context, any rule, or the consuming prompt's free definitions.
Import accepts at most 5 MiB of file bytes and rejects duplicate JSON object keys.
MVP import replaces the whole library after a counts summary and explicit Replace action.
This limits team sharing: importing a colleague's file replaces the recipient's library; v0.1 cannot combine them.
Offer Export before replacement; cancellation or any validation/quota failure changes nothing.
Commit the validated library as one local-storage value; serialize writes through the worker.
After successful replacement clear usage, remembered values, and any open fill snapshot.
Keep local settings and the capture slot; do not import personal activity or permissions.
Export uses a user-initiated local file download; it needs no `downloads` permission.
Uninstall removes local data; exported files are the backup and team-sharing mechanism.
Future versions migrate older known schemas in memory, validate, then commit atomically.
Version 1 accepts only version 1; unknown newer versions fail without modification.
Never silently drop unfamiliar fields or downgrade a file; report the required version.

# 11. Chrome permissions

| Permission or declaration | MVP justification |
| --- | --- |
| `storage` | Persist the library, transient captures, and opted-in small settings. |
| `activeTab` | Temporarily inspect the tab the user explicitly invokes capture on. |
| `scripting` | Read top-frame selection during an explicit capture only. |
| `contextMenus` | Offer link capture through the browser context menu. |
| `clipboardWrite` | Copy the reviewed result from the extension document. |
| Optional `clipboardRead` | Read text only when a referenced clipboard variable is requested. |
| Optional `tabs` | Discover other tabs' URL/title for picker and last-non-chat mode. |

`commands`, `action`, and the omnibox keyword are declarations, not permission strings.
Request optional permissions from explicit Enable/Read buttons in extension UI.
No broad host permissions, `unlimitedStorage`, `downloads`, or persistent content scripts in MVP.
`activeTab` cannot read arbitrary background tabs; optional `tabs` trades broader metadata
visibility for those two source strategies, without granting arbitrary page-DOM access.
Selection capture fails gracefully on restricted pages; never request broader access to bypass it.
See [activeTab grants](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
and [tab metadata access](https://developer.chrome.com/docs/extensions/reference/api/tabs).

# 12. Privacy and security

Prompt content, ticket URLs, captured text, and remembered values are processed on-device.
Mise makes no network requests for content, analytics, error reports, or model calls.
“Nothing leaves the machine” covers Mise content handling, not explicit external actions.
Opted-in Chrome settings sync sends its small setting through Chrome's sync service.
Export files and the OS clipboard can expose internal text to other applications or people.
OS clipboard history/cloud sync may retain or transmit copied text independently of Mise.
Pasting into chat shares text with that application's provider under its own policies.
State these boundaries in settings; do not promise encrypted local storage or secure deletion.

`{{clipboard}}` never triggers background polling or an automatic read on popup opening.
Show an explicit Read clipboard action only if the expanded prompt references it.
Request optional permission then read plain text once; keep it only in the current fill.
Never export or remember clipboard contents; cancel/close discards the in-memory value.
Treat templates, imported files, URLs, selection, and clipboard as untrusted plain text.
Render previews and search results as text, never executable markup or evaluated expressions.
Limit regex input URLs to 16 KiB and bound regex evaluation per rule to 100 ms in a disposable worker.
Wait separately up to 2000 ms for worker startup; startup failures are worker errors.
Timeout terminates that worker and blocks fill with the rule ID; no silent fallback.
Restrict storage access to trusted extension contexts; content scripts receive only needed data.
Validate message sender and shape; do not expose library-reading handlers to ordinary pages.
Do not log bodies, URLs, free values, or clipboard data in diagnostics.
Future adapters require explicit per-site authorization and minimal frame/host access.
An adapter transmits only the reviewed text to the selected editor, never the library.

# 13. Architecture

| Component | Responsibility and boundary |
| --- | --- |
| MV3 service worker | Browser events, capture slot, activity ordering, validated storage writes. |
| Popup / palette document | Search, source choice, free-input form, preview, clipboard operations. |
| Options page | CRUD, rule ordering, chat-host configuration, permissions, import/export. |
| On-demand capture content script | Return top-frame selection; no library access or persistent observer. |
| Template module | Pure parsing, escapes, partial expansion, variable requirements, rendering. |
| Context module | Source snapshots, URL accessors, precedence, and fill-time context errors. |
| Rule worker | Bounded regex evaluation returning named strings or a structured error. |
| Library module | Schema/semantic validation, serialization, migration, storage quota handling. |
| Ranking module | Shared fuzzy search and deterministic scope/usage ordering. |
| Later adapter registry | Destination matching and verified editor insertion with copy fallback. |

The worker must rehydrate state after suspension; globals are caches, never persistence.
A fill snapshot is immutable except explicit source/input changes, which rebuild its preview.
Popup closure discards unsaved fill input; durable library edits require confirmed storage success.
Only the service worker writes durable state; stale editor saves are rejected for reload.
Clipboard success and its associated usage update are separate; report usage-write failure
without retrying the clipboard write or claiming the clipboard operation failed.

# 14. Phasing

| Phase | Included |
| --- | --- |
| v0.1 MVP | Local CRUD; nested partials; every specified variable kind and URL accessor. |
| v0.1 MVP | example Jira rules, editable ordered rules, explicit capture, optional alternate strategies. |
| v0.1 MVP | Popup, global palette, omnibox, link capture, scope/search/usage ranking. |
| v0.1 MVP | Preview, clipboard delivery, permission-denial paths, versioned JSON import/export. |
| v0.1 MVP | Local settings and opt-in sync of the strategy setting only. |
| v0.2 | Ona / Gitpod adapter after editor investigation; per-site registry and copy fallback. |
| v0.2 | Merge-on-import, pending the collision-policy decision below. |
| Later | Additional chat adapters only when individually validated against real editors. |

v0.1 contains no direct injection; its complete useful outcome is a reviewed copied prompt.
v0.2 retains the same source confirmation and never adds automatic submission.

# 15. Acceptance criteria for v0.1

1. Create, edit, delete, and restart Chrome: remaining library records survive unchanged.
2. Import the example file: four prompts, four partials, and two site rules validate.
3. Fill implement-ticket from the example URL: match section 6's real prompt byte-for-byte.
4. Fill ticket-summary from queue URLs for OPS, WEB, SEC, and PLAT: project and issue match each URL.
5. Fill ticket-summary from `/projects/WEB/queues/custom/43/OPS-4821`: neither example Jira rule matches and Copy is blocked.
6. Render host/path/query accessors: first duplicate query value wins; missing value errors.
7. Render an escaped opening delimiter: emit literal `{{`; substituted tokens stay literal.
8. Include eight partial levels successfully; level nine and a cycle fail with a path.
9. Omit a required variable or partial: show its origin and prevent clipboard modification.
10. Fill GitHub review twice: remembered focus overrides default after successful first Copy.
11. Cancel changed free input or disable remembering: no cancelled or stale value is reused.
12. Capture tab A, navigate/close it, and fill in tab B: source stays the captured URL.
13. Suspend the service worker: the slot remains; restart Chrome: the slot is empty.
14. Capture a link: resolve its target URL and mark title/selection unavailable.
15. Enable last-non-chat: exclude configured hosts and allow one-click picker override.
16. Deny/revoke optional tabs permission: alternate strategies explain failure; capture still works.
17. Select a picker tab: use its URL/title without navigating it or overwriting the slot.
18. Search partial text and tags: find consuming prompts; active scope wins the defined sort.
19. Invoke palette by assigned shortcut: complete the documented keyboard-only flow.
20. Invoke omnibox and link menu: open the selected fill and capture the correct link respectively.
21. Preview every strategy: display the complete source URL before Copy can be activated.
22. Copy then paste into Ona/Gitpod and a plain text field: text matches preview without sending.
23. Force clipboard write failure: no success toast or usage increment; manual text remains available.
24. Reference clipboard: no read before consent; denial blocks fill; its value never persists.
25. Export and reimport: library is structurally identical, with no capture or remembered values.
26. Import malformed, duplicate-key, oversized, or future-version JSON: existing library is unchanged.
27. Trigger storage quota failure on replacement: retain the prior complete library.
28. Disable sync and inspect extension traffic during capture/fill/copy: no content leaves via Mise.
29. Import markup and pathological regex: markup is inert; timed-out rule blocks without UI hang.
30. Use a restricted page or unassigned shortcut: show actionable failure and keep library UI usable.
31. Fill ticket-summary from `https://jira.example.com/browse/OPS-4821`: derive OPS and OPS-4821; also verify WEB, SEC, and PLAT browse URLs.

# 16. Open questions

| Question | Decision it blocks |
| --- | --- |
| Which exact Ona/Gitpod hosts and editor/frame types are deployed? | First adapter selectors, insertion path, and optional host grants. |
| Which managed Chrome policies apply to clipboard, extensions, and optional permissions? | Deployment compatibility sign-off; MVP retains explicit failure paths. |
| Are cross-origin iframe selections needed in the real workflow? | Whether a later capture capability needs additional frame permissions. |
| How should merge-on-import resolve IDs shared by two libraries and partial-name collisions, where references use names? | v0.2 merge conflict policy, including preservation of partial-reference meaning. |
