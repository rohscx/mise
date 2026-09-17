import { MAX_IMPORT_BYTES } from '../core/json.js';
import { prepareImport } from './editor.js';
import { element } from './dom.js';

export interface TransferActions { export(): Promise<void>; replace(text: string): Promise<void>; error(error: unknown): void }
export function wireTransfer(actions: TransferActions): void {
  const file = element('import-file', HTMLInputElement), summary = element('import-status', HTMLParagraphElement);
  const replacement = element('replacement', HTMLDivElement);
  let pending: string | null = null, generation = 0;
  const clear = (): void => { generation++; pending = null; replacement.hidden = true; file.value = ''; summary.textContent = ''; };
  file.addEventListener('change', () => {
    const selected = file.files?.[0], current = ++generation;
    pending = null; replacement.hidden = true; summary.textContent = '';
    if (!selected) return;
    if (selected.size > MAX_IMPORT_BYTES) { summary.textContent = 'Import exceeds 5 MiB. Existing library unchanged.'; return; }
    void selected.text().then(text => {
      if (current !== generation) return;
      const result = prepareImport(text);
      if (!result.ok) { summary.textContent = result.issues.map(i => `${i.path}: ${i.message}`).join('\n'); return; }
      pending = result.value.text; summary.textContent = result.value.summary; replacement.hidden = false;
    }).catch(error => { if (current === generation) actions.error(error); });
  });
  for (const id of ['export', 'export-first']) element(id, HTMLButtonElement).addEventListener('click', () => { void actions.export().catch(actions.error); });
  element('cancel-import', HTMLButtonElement).addEventListener('click', clear);
  element('replace', HTMLButtonElement).addEventListener('click', () => {
    if (pending === null) return;
    void actions.replace(pending).then(clear).catch(actions.error);
  });
}
export function downloadLibrary(text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'mise-library.json';
  document.body.append(link); link.click(); link.remove();
  // Keep the URL alive long enough for Chrome to consume the user-initiated download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
