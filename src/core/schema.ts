import type { ExportFile, FreeVariable, PromptPartial, Prompt, SiteRule } from '../shared/types.js';

export interface ValidationIssue { path: string; message: string }
export type Validation<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function fields(value: unknown, keys: string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v: unknown) => typeof v === 'string') && new Set(value).size === value.length;
}
function id(value: unknown): value is string { return typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value) && value.trim() === value; }
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function free(value: unknown): FreeVariable | null {
  if (!fields(value, ['kind', 'name', 'label', 'defaultValue', 'rememberLast']) || value.kind !== 'free'
    || typeof value.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value.name) || value.name.trim() !== value.name
    || !nonempty(value.label) || typeof value.defaultValue !== 'string' || typeof value.rememberLast !== 'boolean') return null;
  return { kind: 'free', name: value.name, label: value.label, defaultValue: value.defaultValue, rememberLast: value.rememberLast };
}
function prompt(value: unknown): Prompt | null {
  if (!fields(value, ['id', 'name', 'body', 'tags', 'scope', 'variables']) || !id(value.id) || !nonempty(value.name)
    || typeof value.body !== 'string' || !strings(value.tags) || !strings(value.scope) || !Array.isArray(value.variables)) return null;
  const variables: FreeVariable[] = [];
  for (const entry of value.variables) { const parsed = free(entry); if (!parsed) return null; variables.push(parsed); }
  return { id: value.id, name: value.name, body: value.body, tags: [...value.tags], scope: [...value.scope], variables };
}
function partial(value: unknown): PromptPartial | null {
  if (!fields(value, ['name', 'body']) || !id(value.name) || typeof value.body !== 'string') return null;
  return { name: value.name, body: value.body };
}
function rule(value: unknown): SiteRule | null {
  if (!fields(value, ['id', 'match', 'regex', 'flags']) || !id(value.id) || !nonempty(value.match)
    || !nonempty(value.regex) || [...value.regex].length > 4096 || (value.flags !== '' && value.flags !== 'i')) return null;
  return { id: value.id, match: value.match, regex: value.regex, flags: value.flags };
}

export function validateShape(value: unknown): Validation<ExportFile> {
  if (!fields(value, ['schemaVersion', 'prompts', 'partials', 'siteRules'])) {
    return { ok: false, issues: [{ path: '$', message: 'Expected exactly schemaVersion, prompts, partials, siteRules' }] };
  }
  if (value.schemaVersion !== 1) return { ok: false, issues: [{ path: '$.schemaVersion', message: `Version 1 required; received ${typeof value.schemaVersion === 'number' || typeof value.schemaVersion === 'string' ? value.schemaVersion : typeof value.schemaVersion}` }] };
  if (!Array.isArray(value.prompts) || !Array.isArray(value.partials) || !Array.isArray(value.siteRules)) {
    return { ok: false, issues: [{ path: '$', message: 'Library collections must be arrays' }] };
  }
  const issues: ValidationIssue[] = [];
  const collect = <T>(entries: unknown[], parse: (entry: unknown) => T | null, path: string): T[] => {
    const result: T[] = [];
    entries.forEach((entry: unknown, index: number) => {
      const parsed = parse(entry);
      if (parsed === null) issues.push({ path: `${path}[${index}]`, message: 'Invalid fields, types, or schema constraints' });
      else result.push(parsed);
    });
    return result;
  };
  const library: ExportFile = { schemaVersion: 1, prompts: collect(value.prompts, prompt, '$.prompts'),
    partials: collect(value.partials, partial, '$.partials'), siteRules: collect(value.siteRules, rule, '$.siteRules') };
  return issues.length ? { ok: false, issues } : { ok: true, value: library };
}
