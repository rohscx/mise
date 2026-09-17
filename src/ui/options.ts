import type { Payload, Request, Response } from '../shared/messages.js';
import type { StoredState } from '../shell/storage.js';
import { isRecord } from '../core/schema.js';
import { emptyState } from '../shell/storage.js';
import { button, element } from './dom.js';
import { draftSave, libraryDiagnostics, analyzeEditor, referenceCount } from './editor.js';
import { node } from './options-dom.js';
import { renderEditor } from './options-editor.js';
import type { EditorView, LibrarySection } from './options-editor.js';
import { renderSettings } from './options-settings.js';
import { downloadLibrary, wireTransfer } from './options-transfer.js';
import { moveRule } from './rules-ui.js';

type Section = LibrarySection | 'settings' | 'transfer';
let stored = emptyState(), library = structuredClone(stored.state.library);
let section: Section = 'prompts', selected = 0, dirty = false, busy = false, loaded = false;
let view: EditorView = { refresh: (): void => undefined };
const workspace = element('workspace', HTMLFieldSetElement);
const list = element('library-list', HTMLElement), editor = element('editor', HTMLElement);
const announce = (message: string): void => { element('status', HTMLParagraphElement).textContent = message; };
const error = (reason: unknown): void => { announce(reason instanceof Error ? reason.message : 'Operation failed. Your edits remain here.'); };
async function request(message: Request): Promise<Payload> {
  const response: Response = await chrome.runtime.sendMessage(message);
  if (!response.ok) throw new Error(response.error);
  return response.data;
}
function statePayload(value: Payload): StoredState {
  if (!isRecord(value) || !('state' in value) || !('revision' in value) || typeof value.revision !== 'number') throw new Error('Invalid state response');
  return value as unknown as StoredState;
}
async function operation(work: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true; workspace.disabled = true; element('reload', HTMLButtonElement).disabled = true;
  try { await work(); }
  finally { busy = false; workspace.disabled = !loaded; element('reload', HTMLButtonElement).disabled = false; }
}
function changed(): void { dirty = true; refresh(); }
function refresh(): void {
  view.refresh();
  element('dirty', HTMLSpanElement).textContent = dirty ? 'Unsaved changes' : 'Saved';
  element('library-errors', HTMLPreElement).textContent = libraryDiagnostics(library).join('\n') || 'No library errors.';
  renderList();
}
function renderList(): void {
  list.replaceChildren();
  if (section === 'settings' || section === 'transfer') return;
  const active = section;
  library[active].forEach((item, index) => {
    let title: string;
    if (active === 'siteRules') title = `${index + 1}. ${'id' in item ? item.id : ''}`;
    else {
      const name = 'name' in item ? item.name : '';
      const origin = active === 'prompts' ? { kind: 'prompt' as const, name: 'id' in item ? item.id : '' }
        : { kind: 'partial' as const, name };
      title = `${name || '(unnamed)'}${analyzeEditor(library, origin).draft ? ' — Draft' : ''}`;
      if (active === 'partials') title += ` (${referenceCount(library, name)} references)`;
    }
    const choose = button(title, () => { selected = index; render(); });
    choose.setAttribute('aria-current', String(index === selected)); list.append(choose);
    if (active === 'siteRules') {
      const order = node('div'); order.className = 'actions';
      for (const direction of [-1, 1] as const) {
        const move = button(direction === -1 ? 'Move up' : 'Move down', () => {
          library.siteRules = moveRule(library.siteRules, index, direction);
          if (selected === index) selected += direction;
          else if (selected === index + direction) selected = index;
          dirty = true; render();
          list.querySelector<HTMLButtonElement>('button[aria-current="true"]')?.focus();
        });
        move.disabled = index + direction < 0 || index + direction >= library.siteRules.length;
        move.setAttribute('aria-label', `${move.textContent}: ${title}`); order.append(move);
      }
      list.append(order);
    }
  });
}
function render(): void {
  const editing = section !== 'settings' && section !== 'transfer';
  element('library-panel', HTMLElement).hidden = !editing;
  element('settings-panel', HTMLElement).hidden = section !== 'settings';
  element('transfer-panel', HTMLElement).hidden = section !== 'transfer';
  for (const child of Array.from(element('sections', HTMLElement).children)) child.setAttribute('aria-current', String(child.getAttribute('data-section') === section));
  if (section !== 'settings' && section !== 'transfer') {
    element('add', HTMLButtonElement).textContent = section === 'prompts' ? 'New prompt' : section === 'partials' ? 'New partial' : 'New site rule';
    view = renderEditor(editor, library, section, selected, changed, () => {
      if (section === 'settings' || section === 'transfer' || !window.confirm('Delete this record from the draft? Save draft to commit the deletion.')) return;
      library[section].splice(selected, 1); selected = Math.max(0, selected - 1); dirty = true; render();
    });
    if (section === 'siteRules') editor.prepend(node('p', 'First match wins: rules run from top to bottom. Both pattern and regex must match.'));
    refresh();
  } else if (section === 'settings') {
    renderSettings(element('settings-panel', HTMLElement), stored, message => {
      void operation(async () => {
        const result = await request(message);
        if (!isRecord(result) || !('stored' in result)) throw new Error('Invalid settings response');
        stored = statePayload(result.stored);
        render(); announce(result.syncPublished ? 'Settings saved.' : 'Settings saved locally; Chrome sync publication failed.');
      }).catch(reason => { render(); error(reason); });
    }, announce);
  }
}
function accept(value: Payload): void { stored = statePayload(value); loaded = true; library = structuredClone(stored.state.library); dirty = false; render(); }
async function reload(): Promise<void> {
  if (dirty && !window.confirm('Discard unsaved library edits and reload saved state?')) return;
  await operation(async () => { accept(await request({ type: 'state' })); announce('Loaded saved library.'); });
}
for (const [value, title] of [['prompts', 'Prompts'], ['partials', 'Partials'], ['siteRules', 'Site rules'], ['settings', 'Settings'], ['transfer', 'Import / export']] as const) {
  const tab = button(title, () => { section = value; selected = 0; render(); }); tab.dataset.section = value;
  element('sections', HTMLElement).append(tab);
}
element('add', HTMLButtonElement).addEventListener('click', () => {
  const id = `new-${crypto.randomUUID()}`;
  if (section === 'prompts') library.prompts.push({ id, name: 'New prompt', body: '', tags: [], scope: [], variables: [] });
  else if (section === 'partials') library.partials.push({ name: id, body: '' });
  else if (section === 'siteRules') library.siteRules.push({ id, match: 'https://example.com/*', regex: '^https://example\\.com/(?<value>.*)$', flags: '' });
  else return;
  selected = library[section].length - 1; dirty = true; render();
});
element('save', HTMLButtonElement).addEventListener('click', () => {
  void operation(async () => {
    const result = await request(draftSave(library, stored.revision));
    accept(result); announce(libraryDiagnostics(library).length ? 'Draft saved with diagnostics. Fix errors before export or Copy.' : 'Library saved.');
  }).catch(error);
});
element('reload', HTMLButtonElement).addEventListener('click', () => { void reload().catch(error); });
wireTransfer({ error,
  export: async (): Promise<void> => operation(async () => {
    const result = await request({ type: 'export' });
    if (typeof result !== 'string') throw new Error('Invalid export response');
    downloadLibrary(result); announce(dirty ? 'Saved library download requested; unsaved edits are not included.' : 'Library download requested.');
  }),
  replace: async (text: string): Promise<void> => operation(async () => {
    if (dirty && !window.confirm('Replacement also discards your unsaved library edits. Continue?')) throw new Error('Replacement cancelled. Existing library unchanged.');
    accept(await request({ type: 'import', revision: stored.revision, text })); announce('Library replaced.');
  }),
});
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
void reload().catch(error);
