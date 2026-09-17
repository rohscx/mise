# Mise

Mise is a Chromium extension for reusable work prompts. It stores prompt
templates, fills them with context taken from the browser — above all the URL of
another tab — and puts the finished text on the clipboard for you to paste into
an AI chat window.

The name is from *mise en place*: everything prepped before the work starts.

## Why

The prompts people reuse are mostly fixed text. Typically only a URL changes
between uses, and that URL lives in a different tab from the chat window it has
to end up in. Keeping those prompts in a notepad means copying, hand-editing the
URL, and pasting — every time. It also means the standing instructions repeated
across every prompt get edited in a dozen places when they change.

Mise addresses both:

- **Templates with variables.** `{{url}}`, `{{title}}`, `{{selection}}` and
  `{{date}}` resolve from browser context. Free variables prompt for a value at
  fill time.
- **Derived variables.** Site rules map a URL to named captures by regex, so a
  ticket link yields `{{project}}` and `{{ticket}}` without parsing by hand.
- **Partials.** Standing instructions live in one named fragment included with
  `{{> name}}`. Edit it once; every prompt that includes it follows.
- **Cross-tab capture.** Capture the source URL in one tab, fill the prompt in
  another. The resolved source is always shown before anything is copied.
- **Site scoping.** Prompts declare URL patterns and sort to the top when the
  active tab matches.

Everything stays on the machine. Mise makes no network requests, and the
library is portable through versioned JSON export and import.

## Status

Implementation is in progress, and [SPEC.md](SPEC.md) is normative.
[examples/prompts.example.json](examples/prompts.example.json) is a valid library
in the documented export format.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
