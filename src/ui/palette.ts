import type { FillData, Request, Response } from '../shared/messages.js';
import type { CaptureSlot } from '../shared/types.js';
import type { StoredState } from '../shell/storage.js';
import { parseInvocation } from '../shell/palette.js';
import { browserRegexExecutor } from '../shell/regex-worker.js';
import { prepareFill, renderFill } from '../core/resolve.js';
import type { FillSnapshot } from '../core/resolve.js';
import { buildSearchIndex, rankPrompts } from '../core/ranking.js';
import { annotations, fillErrors, renderPreview } from './preview.js';
import { canClearCapture, copyFill, inputValues, rowStates, searchSelection, sourceText } from './interaction.js';
import { button, element } from './dom.js';

const search = element('search', HTMLInputElement);
const results = element('results', HTMLDivElement);
const copy = element('copy', HTMLButtonElement);
const read = element('read', HTMLButtonElement);
const inputs = element('inputs', HTMLDivElement);
const source = element('source', HTMLDivElement);
const preview = element('preview', HTMLPreElement);
const status = element('status', HTMLDivElement);
const fillPanel = element('fill', HTMLElement);
const picker = element('picker', HTMLElement);
const tabQuery = element('tab-query', HTMLInputElement);
const execute = browserRegexExecutor(chrome.runtime.getURL('regex.js'));
let stored: StoredState | null = null;
let activeUrl: string | null = null;
let snapshot: FillSnapshot | null = null;
let data: FillData | null = null;
let values: Record<string, string> = inputValues([]);
let promptId: string | null = null;
let picked: number | undefined;
let selected = 0;
let matches: { id: string; name: string }[] = [];
let epoch = 0;
let copying = false;
let tabsEpoch = 0;
const announce = (text: string): void => { status.textContent = text; };
async function request<T>(message: Request): Promise<T> {
  const response: Response = await chrome.runtime.sendMessage(message);
  if (!response.ok) throw new Error(response.error);
  return response.data as T;
}
function run(task: () => Promise<void>): void {
  void task().catch(error => announce(error instanceof Error ? error.message : 'Browser access failed. Reopen Mise and retry.'));
}
function discard(): void {
  epoch++; snapshot = null; data = null; values = inputValues([]);
  copy.disabled = true; fillPanel.hidden = true; preview.replaceChildren(); inputs.replaceChildren();
}
function drawSearch(): void {
  if (!stored) return;
  matches = rankPrompts(buildSearchIndex(stored.state.library), search.value, activeUrl, stored.state.usage)
    .map(({ prompt }) => ({ id: prompt.id, name: prompt.name }));
  selected = searchSelection(selected, '', matches.length);
  const ids = matches.map(match => match.id);
  const states = rowStates(ids, selected, promptId);
  // Selecting a prompt re-runs this only to move the highlight. Rebuilding
  // every row for that discards focus and makes the list visibly churn, so the
  // nodes are reused whenever the result set itself has not changed.
  const rows = Array.from(results.querySelectorAll('button'));
  const unchanged = rows.length === ids.length && rows.every((row, index) => row.dataset.id === ids[index]);
  if (!unchanged) {
    results.replaceChildren(...matches.map((match, index) => {
      const node = button(match.name, () => { selected = index; run(() => selectPrompt(match.id)); });
      node.dataset.id = match.id;
      return node;
    }));
  }
  Array.from(results.querySelectorAll('button')).forEach((node, index) => {
    node.setAttribute('aria-current', String(states[index]?.current ?? false));
    node.classList.toggle('cursor', states[index]?.cursor ?? false);
  });
  if (!matches.length) results.textContent = stored.state.library.prompts.length ? 'No matching prompts.' : 'No prompts in the library.';
}
function drawFill(): void {
  if (!snapshot) return;
  const result = renderFill(snapshot, values);
  const parts = annotations(snapshot, values, result);
  renderPreview(preview, parts);
  source.textContent = sourceText(snapshot.context.source, snapshot.context.strategy, Date.now());
  element('errors', HTMLDivElement).textContent = fillErrors(result);
  read.hidden = !snapshot.expansion.tokens.some(t => t.kind === 'variable' && t.value === 'clipboard');
  copy.disabled = !result.ok || copying || parts.some(part => part.kind === 'unresolved');
}
async function prepare(next: FillData, ticket: number, focus: boolean): Promise<void> {
  const prompt = next.library.prompts.find(p => p.id === next.promptId);
  if (!prompt) throw new Error('Prompt no longer exists. Search again.');
  const ready = await prepareFill(prompt, next.library, next.context, next.remembered, execute);
  if (ticket !== epoch) return;
  data = next; snapshot = ready; values = inputValues(Object.entries(ready.values));
  inputs.replaceChildren(...ready.inputs.map((variable, index) => {
    const label = document.createElement('label'); label.textContent = variable.label;
    const input = document.createElement('input'); input.id = `value-${index}`; label.htmlFor = input.id;
    input.value = values[variable.name] ?? ''; input.autocomplete = 'off';
    input.addEventListener('input', () => { values[variable.name] = input.value; drawFill(); });
    label.append(input); return label;
  }));
  element('prompt-name', HTMLHeadingElement).textContent = prompt.name;
  fillPanel.hidden = false; drawFill();
  if (focus) (inputs.querySelector('input') ?? (read.hidden ? preview : read)).focus();
}
async function selectPrompt(id: string, focus = true): Promise<void> {
  // Keep the previous fill on screen while the next one loads. Tearing it down
  // first collapses the popup to its min-height and expands it again when the
  // data lands, which reads as a flash on every selection.
  epoch++; promptId = id;
  const ticket = epoch;
  copy.disabled = true;
  fillPanel.setAttribute('aria-busy', 'true');
  drawSearch();
  try {
    const next = await request<FillData>(picked === undefined ? { type: 'fill', promptId: id } : { type: 'fill', promptId: id, tabId: picked });
    await prepare(next, ticket, focus);
  } catch (error) {
    if (ticket === epoch) discard();
    throw error;
  } finally {
    if (ticket === epoch) fillPanel.removeAttribute('aria-busy');
  }
}
async function staged(): Promise<void> {
  const slot = await request<CaptureSlot | null>({ type: 'slot' });
  element('clear', HTMLButtonElement).disabled = !canClearCapture(slot);
  element('staged', HTMLDivElement).textContent = slot ? `Staged: ${sourceText(slot, 'capture', Date.now())}`
    : 'No captured source. Capture current tab or Choose tab.';
}
async function showTabs(): Promise<void> {
  const ticket = ++tabsEpoch;
  const tabs = await request<CaptureSlot[]>({ type: 'tabs', query: tabQuery.value });
  if (ticket !== tabsEpoch) return;
  const target = element('tabs', HTMLDivElement);
  target.replaceChildren(...tabs.map(tab => button(`${tab.title ?? 'Untitled'}\n${tab.url}`, () => {
    if (tab.sourceTabId === null) return;
    picked = tab.sourceTabId; picker.hidden = true;
    if (promptId) run(() => selectPrompt(promptId ?? ''));
    else { announce('Source tab chosen. Select a prompt.'); search.focus(); }
  })));
  if (!tabs.length) target.textContent = 'No matching tabs.';
}
search.addEventListener('input', () => { selected = 0; drawSearch(); });
search.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); selected = searchSelection(selected, event.key, matches.length); drawSearch();
    results.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }
  if (event.key === 'Enter') {
    event.preventDefault(); const match = matches[selected]; if (match) run(() => selectPrompt(match.id));
  }
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') { discard(); window.close(); } });
element('capture', HTMLButtonElement).addEventListener('click', () => run(async () => {
  discard(); picked = undefined; await request({ type: 'capture' }); await staged();
  if (promptId) await selectPrompt(promptId);
}));
element('clear', HTMLButtonElement).addEventListener('click', () => run(async () => {
  discard(); picked = undefined; await request({ type: 'clear-capture' }); await staged();
}));
element('choose', HTMLButtonElement).addEventListener('click', () => run(async () => {
  if (!await chrome.permissions.request({ permissions: ['tabs'] })) {
    announce('Tabs permission denied. Capture current tab instead.'); return;
  }
  picker.hidden = false; await showTabs(); tabQuery.focus();
}));
tabQuery.addEventListener('input', () => run(showTabs));
read.addEventListener('click', () => run(async () => {
  const current = data; if (!current) return;
  const ticket = epoch; const previous = inputValues(Object.entries(values));
  if (!await chrome.permissions.request({ permissions: ['clipboardRead'] })) {
    announce('Clipboard permission denied. Allow clipboard access and select Read clipboard.'); return;
  }
  if (!document.hasFocus()) throw new Error('Focus Mise, then select Read clipboard.');
  let clipboard: string;
  try { clipboard = await navigator.clipboard.readText(); }
  catch { throw new Error('Clipboard read failed. Focus Mise and select Read clipboard to retry.'); }
  if (ticket !== epoch) return;
  await prepare({ ...current, context: { ...current.context, clipboard } }, ticket, false);
  if (ticket === epoch) {
    values = previous;
    inputs.querySelectorAll('input').forEach((input, index) => { input.value = values[snapshot?.inputs[index]?.name ?? ''] ?? ''; });
    drawFill();
  }
}));
copy.addEventListener('click', () => run(async () => {
  if (!snapshot || !data || copying) return;
  const result = renderFill(snapshot, values);
  if (!result.ok || annotations(snapshot, values, result).some(part => part.kind === 'unresolved')) return;
  const current = data; const copiedValues = inputValues(Object.entries(values));
  copying = true; copy.disabled = true;
  await copyFill(result.output, {
    write: async (text): Promise<void> => {
      if (!document.hasFocus()) throw new Error('Document is not focused');
      await navigator.clipboard.writeText(text);
    }, announce,
    remember: async (): Promise<void> => {
      stored = await request<StoredState>({ type: 'copied', revision: current.revision, generation: current.generation,
        promptId: current.promptId, values: copiedValues }); drawSearch();
    },
  });
  copying = false; drawFill();
}));
async function invoke(route = false): Promise<void> {
  discard(); promptId = null; picked = undefined; search.focus();
  const ticket = epoch;
  const [state, window] = await Promise.all([request<StoredState>({ type: 'state' }),
    chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] }).catch(() => null)]);
  if (ticket !== epoch) return;
  stored = state; activeUrl = window?.tabs?.find(tab => tab.active)?.url ?? null;
  search.value = ''; selected = 0; drawSearch(); await staged();
  if (route) {
    const invocation = parseInvocation(await request({ type: 'invocation' }));
    if (ticket !== epoch) return;
    if (invocation.query !== undefined) { search.value = invocation.query; drawSearch(); }
    if (invocation.promptId) await selectPrompt(invocation.promptId);
  }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.invocation && !location.search) run(() => invoke(true));
  if (area === 'session' && changes.slot) {
    run(staged);
    if (picked === undefined && stored?.state.strategy === 'capture' && promptId) run(() => selectPrompt(promptId ?? '', false));
  }
  if (area === 'local' && changes.state) run(async () => {
    const next = await request<StoredState>({ type: 'state' });
    if (stored && next.generation !== stored.generation) { discard(); promptId = null; announce('Library replaced. Select a prompt again.'); }
    stored = next; drawSearch();
  });
});
chrome.runtime.onMessage.addListener((message: unknown) => {
  if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'library-replaced') {
    discard(); promptId = null; announce('Library replaced. Select a prompt again.');
  }
});
window.addEventListener('pageshow', () => run(async () => {
  const next = await request<StoredState>({ type: 'state' });
  if (data && next.generation !== data.generation) discard();
}));
setInterval(() => { run(staged); if (snapshot) source.textContent = sourceText(snapshot.context.source, snapshot.context.strategy, Date.now()); }, 30000);
run(async () => {
  await invoke(!location.search);
  const commands = await chrome.commands.getAll();
  const shortcut = commands.find(command => command.name === 'open-palette')?.shortcut;
  element('shortcut', HTMLParagraphElement).textContent = shortcut ? `Open Mise: ${shortcut}` : 'No shortcut assigned. Assign Open Mise in Chrome’s extension shortcuts.';
});
