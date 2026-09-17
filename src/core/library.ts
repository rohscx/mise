import type { ExportFile, LocalState } from '../shared/types.js';
import { captureNames, isReserved, validMatchPattern, validRule } from './rules.js';
import { expandTemplate, renderTemplate } from './template.js';
import { validateShape } from './schema.js';
import type { Validation, ValidationIssue } from './schema.js';
import { MAX_IMPORT_BYTES, parseLibraryJson } from './json.js';

export function validateLibrary(input: unknown, mode: 'complete' | 'draft' = 'complete'): Validation<ExportFile> {
  const shape = validateShape(input);
  if (!shape.ok) return shape;
  const library = shape.value;
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string): void => { issues.push({ path, message }); };
  const unique = (names: string[], path: string): void => {
    if (new Set(names).size !== names.length) add(path, 'Names or IDs must be unique');
  };
  unique(library.prompts.map(p => p.id), '$.prompts');
  unique(library.partials.map(p => p.name), '$.partials');
  unique(library.siteRules.map(r => r.id), '$.siteRules');
  const captures = new Set(library.siteRules.flatMap(r => captureNames(r.regex)));
  for (const rule of library.siteRules) if (!validRule(rule)) add(`rule:${rule.id}`, 'Invalid pattern, regex, flags, or capture name');
  const check = (body: string, name: string, kind: 'prompt' | 'partial', free: Set<string> | null): void => {
    const expanded = expandTemplate(body, { kind, name }, library.partials);
    for (const problem of expanded.problems) add(`${problem.origin.kind}:${problem.origin.name}:${problem.offset}`,
      `${problem.code}: ${problem.token}; path ${problem.path.join(' -> ')}`);
    for (const token of expanded.tokens) {
      if (token.kind === 'variable' && !isReserved(token.value) && !captures.has(token.value)
        && free !== null && !free.has(token.value)) add(`${token.origin.kind}:${token.origin.name}:${token.offset}`, `Unknown variable ${token.value}`);
    }
    const rendered = renderTemplate(expanded, () => '');
    if (rendered.problems.some(p => p.code === 'oversize')) add(`${kind}:${name}`, 'Output exceeds 1 MiB');
  };
  for (const prompt of library.prompts) {
    unique(prompt.variables.map(v => v.name), `prompt:${prompt.id}.variables`);
    if (prompt.variables.some(v => isReserved(v.name))) add(`prompt:${prompt.id}`, 'Reserved free variable name');
    if (prompt.scope.some(p => !validMatchPattern(p))) add(`prompt:${prompt.id}`, 'Invalid scope pattern');
    if (mode === 'complete') check(prompt.body, prompt.id, 'prompt', new Set(prompt.variables.map(v => v.name)));
  }
  // An unused partial has no consuming prompt; its free inputs can only be checked by a consumer.
  if (mode === 'complete') for (const partial of library.partials) check(partial.body, partial.name, 'partial', null);
  if (new TextEncoder().encode(JSON.stringify(library)).length > MAX_IMPORT_BYTES) add('$', 'Library exceeds 5 MiB');
  return issues.length ? { ok: false, issues } : { ok: true, value: library };
}

export function importLibrary(text: string | Uint8Array): Validation<ExportFile> {
  const parsed = parseLibraryJson(text);
  return parsed.ok ? validateLibrary(parsed.value) : parsed;
}

export function exportLibrary(input: unknown): Validation<string> {
  const validated = validateLibrary(input);
  if (!validated.ok) return validated;
  const text = JSON.stringify(validated.value, null, 2) + '\n';
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) {
    return { ok: false, issues: [{ path: '$', message: 'Export exceeds 5 MiB' }] };
  }
  return { ok: true, value: text };
}

export function replacementState(state: LocalState, library: ExportFile): LocalState {
  return { ...structuredClone(state), library: structuredClone(library), usage: {}, remembered: {} };
}
