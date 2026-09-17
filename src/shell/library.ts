import { exportLibrary, importLibrary, validateLibrary } from '../core/library.js';
import { reconcileRemembered } from '../core/resolve.js';
import { parseTemplate } from '../core/template.js';
import type { ExportFile } from '../shared/types.js';
import type { StoredState } from './storage.js';
import { safeClone } from './storage.js';

export function validatedImport(text: string): ExportFile {
  const result = importLibrary(text);
  if (!result.ok) throw new Error(result.issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'));
  return result.value;
}
export function serializedExport(stored: StoredState): string {
  const result = exportLibrary(stored.state.library);
  if (!result.ok) throw new Error('Fix library diagnostics before exporting');
  return result.value;
}
export function editedLibrary(stored: StoredState, library: ExportFile, replace: boolean): StoredState {
  const validated = validateLibrary(library, replace ? 'complete' : 'draft');
  if (!validated.ok) throw new Error('Invalid library');
  if (!replace) {
    const removed = stored.state.library.partials.filter(old => !library.partials.some(p => p.name === old.name));
    for (const partial of removed) {
      const consumers = [...library.prompts.map(p => ({ name: p.id, body: p.body })), ...library.partials];
      if (consumers.some(p => parseTemplate(p.body, { kind: 'partial', name: p.name }).tokens
        .some(token => token.kind === 'include' && token.value === partial.name))) throw new Error('Update partial references before deleting or renaming');
    }
  }
  const next = safeClone(stored);
  next.state.library = safeClone(validated.value);
  if (replace) { next.state.usage = Object.create(null); next.state.remembered = Object.create(null); next.generation++; }
  else {
    for (const id of Object.keys(next.state.usage)) if (!library.prompts.some(p => p.id === id)) delete next.state.usage[id];
    for (const id of Object.keys(next.state.remembered)) {
      const prompt = library.prompts.find(p => p.id === id);
      if (!prompt) delete next.state.remembered[id];
      else next.state.remembered[id] = safeClone(reconcileRemembered(prompt, next.state.remembered[id] ?? {}));
    }
  }
  return next;
}
