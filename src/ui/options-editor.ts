import type { ExportFile, Prompt, PromptPartial, SiteRule } from '../shared/types.js';
import { analyzeEditor, consumerDiagnostics, referenceCount } from './editor.js';
import { button } from './dom.js';
import { check, field, lines, node } from './options-dom.js';
import { testResultText, testRule } from './rules-ui.js';
import { browserRegexExecutor } from '../shell/regex-worker.js';

export type LibrarySection = 'prompts' | 'partials' | 'siteRules';
export interface EditorView { refresh(): void }
export function renderEditor(parent: HTMLElement, library: ExportFile, section: LibrarySection, index: number,
  changed: () => void, remove: () => void): EditorView {
  parent.replaceChildren();
  const item = library[section][index];
  if (!item) { parent.append(node('p', 'Create or select a record to start editing.')); return { refresh: (): void => undefined }; }
  parent.append(node('h2', section === 'prompts' ? 'Prompt' : section === 'partials' ? 'Partial' : 'Site rule'));
  const actions = node('div'); actions.className = 'actions'; actions.append(button('Delete record', remove));
  if (section === 'siteRules') {
    ruleEditor(parent, item as SiteRule, changed); parent.append(actions);
    return { refresh: (): void => undefined };
  }
  const prompt = section === 'prompts' ? item as Prompt : undefined;
  const partial = section === 'partials' ? item as PromptPartial : undefined;
  const count = node('p');
  if (prompt) {
    parent.append(node('p', `Stable ID: ${prompt.id}`));
    field(parent, 'Name', prompt.name, value => { prompt.name = value; changed(); });
    field(parent, 'Tags (one per line)', prompt.tags.join('\n'), value => { prompt.tags = lines(value); changed(); }, true);
    field(parent, 'Scope patterns (one per line; empty means unscoped)', prompt.scope.join('\n'), value => { prompt.scope = lines(value); changed(); }, true);
  } else if (partial) {
    field(parent, 'Partial name', partial.name, value => { partial.name = value; changed(); });
    parent.append(count);
  }
  const bodyLayout = node('div'); bodyLayout.className = 'body-layout';
  const bodyPane = node('div'), previewPane = node('div');
  const template = prompt ?? partial;
  if (!template) throw new Error('Missing template');
  const body = field(bodyPane, 'Body', template.body, value => { template.body = value; changed(); }, true);
  body.spellcheck = false;
  const diagnostics = node('pre'); diagnostics.className = 'diagnostics'; diagnostics.setAttribute('aria-live', 'polite');
  bodyPane.append(diagnostics);
  previewPane.append(node('h3', 'Live preview'), node('p', 'Illustrative only: ⟦name⟧ marks browser/capture values. Free inputs use defaults; no browser context or clipboard is read.'));
  const preview = node('pre'); preview.className = 'preview'; preview.tabIndex = 0; preview.setAttribute('aria-label', 'Live template preview');
  previewPane.append(preview); bodyLayout.append(bodyPane, previewPane); parent.append(bodyLayout);
  if (prompt) variablesEditor(parent, prompt, changed);
  parent.append(actions);
  return { refresh: (): void => {
    const result = analyzeEditor(library, { kind: prompt ? 'prompt' : 'partial', name: prompt?.id ?? partial?.name ?? '' });
    preview.textContent = result.preview;
    const messages = [...result.diagnostics, ...(partial ? consumerDiagnostics(library, partial.name) : [])];
    diagnostics.textContent = [...new Set(messages)].join('\n') || 'No template errors.';
    if (partial) count.textContent = `${referenceCount(library, partial.name)} direct references (distinct prompts or partials). Free names are validated in consuming prompts; see all library diagnostics below.`;
  } };
}
function variablesEditor(parent: HTMLElement, prompt: Prompt, changed: () => void): void {
  parent.append(node('h3', 'Free-variable definitions'));
  const list = node('div'); parent.append(list);
  const render = (): void => {
    list.replaceChildren();
    prompt.variables.forEach((variable, index) => {
      const group = node('fieldset'); group.className = 'variable'; group.append(node('legend', `Free input ${index + 1}`));
      field(group, 'Variable name', variable.name, value => { variable.name = value; changed(); });
      field(group, 'Label', variable.label, value => { variable.label = value; changed(); });
      field(group, 'Default value', variable.defaultValue, value => { variable.defaultValue = value; changed(); }, true);
      check(group, 'Remember last value after Copy', variable.rememberLast, value => { variable.rememberLast = value; changed(); });
      group.append(button('Remove free input', () => { prompt.variables.splice(index, 1); render(); changed(); }));
      list.append(group);
    });
  };
  parent.append(button('Add free input', () => {
    prompt.variables.push({ kind: 'free', name: '', label: '', defaultValue: '', rememberLast: false }); render(); changed();
  }));
  render();
}
function ruleEditor(parent: HTMLElement, rule: SiteRule, changed: () => void): void {
  let generation = 0;
  const result = node('pre'); result.setAttribute('aria-live', 'polite');
  const update = (): void => { generation++; result.textContent = 'Rule changed. Test again.'; changed(); };
  field(parent, 'Rule ID', rule.id, value => { rule.id = value; update(); });
  field(parent, 'HTTP(S) URL match pattern', rule.match, value => { rule.match = value; update(); });
  const regex = field(parent, 'Regex with named captures', rule.regex, value => { rule.regex = value; update(); }, true); regex.spellcheck = false;
  check(parent, 'Case insensitive (i flag)', rule.flags === 'i', value => { rule.flags = value ? 'i' : ''; update(); });
  let input = '';
  field(parent, 'Test URL (never navigates)', '', value => { input = value; generation++; result.textContent = 'URL changed. Test again.'; });
  const run = button('Test URL', () => {
    const current = ++generation;
    result.textContent = 'Testing…';
    void testRule({ ...rule }, input, browserRegexExecutor(chrome.runtime.getURL('regex.js'))).then(outcome => {
      if (current === generation) result.textContent = testResultText(outcome);
    }).catch(() => { if (current === generation) result.textContent = 'Regex worker unavailable'; });
  });
  parent.append(run, result);
}
