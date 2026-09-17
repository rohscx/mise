import { importLibrary, validateLibrary } from '../core/library.js';
import { captureNames, isReserved } from '../core/rules.js';
import { expandTemplate, parseTemplate, renderTemplate } from '../core/template.js';
import type { Origin, Problem } from '../core/template.js';
import type { ExportFile } from '../shared/types.js';
import type { Request } from '../shared/messages.js';
import type { Validation } from '../core/schema.js';

export interface EditorAnalysis { draft: boolean; diagnostics: string[]; preview: string; problems: Problem[] }
export function diagnostic(problem: Problem, library: ExportFile): string {
  const body = problem.origin.kind === 'prompt'
    ? library.prompts.find(p => p.id === problem.origin.name)?.body
    : library.partials.find(p => p.name === problem.origin.name)?.body;
  const prefix = (body ?? '').slice(0, problem.offset).split('\n');
  return `${problem.origin.kind}:${problem.origin.name}:${prefix.length}:${(prefix.at(-1)?.length ?? 0) + 1}: `
    + `${problem.code === 'unresolved' ? 'Unknown variable' : problem.code} ${problem.token}; path ${problem.path.join(' -> ')}`;
}
export function analyzeEditor(library: ExportFile, origin: Origin): EditorAnalysis {
  const prompt = origin.kind === 'prompt' ? library.prompts.find(p => p.id === origin.name) : undefined;
  const body = prompt?.body ?? library.partials.find(p => p.name === origin.name)?.body ?? '';
  const free = new Map(prompt?.variables.map(v => [v.name, v.defaultValue]) ?? []);
  const captures = new Set(library.siteRules.flatMap(r => captureNames(r.regex)));
  const expansion = expandTemplate(body, origin, library.partials);
  const rendered = renderTemplate(expansion, name => {
    if (isReserved(name) || captures.has(name)) return `⟦${name}⟧`;
    if (free.has(name)) return free.get(name) ?? '';
    // Partials declare no inputs; unknown free names are checked in each consuming prompt.
    return origin.kind === 'partial' ? `⟦${name}⟧` : null;
  });
  const diagnostics = rendered.problems.map(p => diagnostic(p, library));
  return { draft: diagnostics.length > 0, diagnostics, preview: rendered.output, problems: rendered.problems };
}
export function consumerDiagnostics(library: ExportFile, partialName: string): string[] {
  return library.prompts.flatMap(prompt => analyzeEditor(library, { kind: 'prompt', name: prompt.id }).problems
    .filter(problem => problem.path.slice(1).includes(partialName))
    .map(problem => diagnostic(problem, library)));
}
export function libraryDiagnostics(library: ExportFile): string[] {
  const structural = validateLibrary(library, 'draft');
  const messages = structural.ok ? [] : structural.issues.map(i => `${i.path}: ${i.message}`);
  for (const prompt of library.prompts) messages.push(...analyzeEditor(library, { kind: 'prompt', name: prompt.id }).diagnostics);
  for (const partial of library.partials) messages.push(...analyzeEditor(library, { kind: 'partial', name: partial.name }).diagnostics);
  return [...new Set(messages)];
}
export function referenceCount(library: ExportFile, name: string): number {
  return [...library.prompts.map(p => ({ name: p.id, body: p.body })), ...library.partials]
    .filter(p => parseTemplate(p.body, { kind: 'partial', name: p.name }).tokens
      .some(t => t.kind === 'include' && t.value === name)).length;
}
export function draftSave(library: ExportFile, revision: number): Extract<Request, { type: 'save' }> {
  return { type: 'save', revision, library: structuredClone(library) };
}
export function prepareImport(text: string): Validation<{ text: string; summary: string }> {
  const result = importLibrary(text);
  if (!result.ok) return result;
  const { prompts, partials, siteRules } = result.value;
  return { ok: true, value: { text, summary: `${prompts.length} prompts, ${partials.length} partials, ${siteRules.length} site rules` } };
}
