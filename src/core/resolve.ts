import type { ExportFile, FillContext, FreeVariable, LocalState, Prompt } from '../shared/types.js';
import { evaluateRules, isReserved, urlAccessor } from './rules.js';
import type { RegexExecutor, RuleResult } from './rules.js';
import { expandTemplate, renderTemplate } from './template.js';
import type { Expansion, RenderResult } from './template.js';

export interface FillSnapshot {
  prompt: Prompt;
  context: FillContext;
  expansion: Expansion;
  rules: RuleResult;
  inputs: FreeVariable[];
  values: Record<string, string>;
}
export interface FillResult extends RenderResult { ruleProblem: RuleResult['problem']; clipboardRequired: boolean }

function supplied(name: string, context: FillContext, rules: RuleResult): string | null {
  if (name === 'url') return context.source.url;
  if (name === 'title') return context.source.title;
  if (name === 'selection') return context.source.selection;
  if (name === 'date') return context.date;
  if (name === 'clipboard') return context.clipboard;
  if (name.startsWith('url.')) return urlAccessor(name, context.source.url);
  return Object.hasOwn(rules.captures, name) ? rules.captures[name] ?? null : null;
}

function freezeSnapshot<T>(value: T, seen = new WeakSet<object>()): T {
  if (value !== null && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    for (const child of Object.values(value)) freezeSnapshot(child, seen);
    Object.freeze(value);
  }
  return value;
}

export async function prepareFill(prompt: Prompt, library: ExportFile, context: FillContext,
  remembered: Readonly<Record<string, string>>, execute: RegexExecutor): Promise<FillSnapshot> {
  const snapshot = structuredClone({ prompt, library, context, remembered });
  const expansion = expandTemplate(snapshot.prompt.body, { kind: 'prompt', name: prompt.id }, snapshot.library.partials);
  const rules = await evaluateRules(snapshot.library.siteRules, snapshot.context.source.url, execute);
  const inputs: FreeVariable[] = [];
  const values: Record<string, string> = Object.create(null);
  const seen = new Set<string>();
  for (const token of expansion.tokens) {
    if (token.kind !== 'variable' || seen.has(token.value) || isReserved(token.value)
      || supplied(token.value, snapshot.context, rules) !== null) continue;
    seen.add(token.value);
    const declaration = snapshot.prompt.variables.find(v => v.name === token.value);
    if (!declaration) continue;
    inputs.push(declaration);
    values[token.value] = declaration.rememberLast && Object.hasOwn(snapshot.remembered, token.value)
      ? snapshot.remembered[token.value] ?? declaration.defaultValue : declaration.defaultValue;
  }
  return freezeSnapshot({ prompt: snapshot.prompt, context: snapshot.context, expansion, rules: structuredClone(rules), inputs, values });
}

export function renderFill(fill: FillSnapshot, values: Readonly<Record<string, string>> = fill.values): FillResult {
  const result = renderTemplate(fill.expansion, name => {
    const value = supplied(name, fill.context, fill.rules);
    if (isReserved(name) || value !== null) return value;
    return fill.inputs.some(v => v.name === name) && Object.hasOwn(values, name) ? values[name] ?? null : null;
  });
  const clipboardRequired = fill.expansion.tokens.some(t => t.kind === 'variable' && t.value === 'clipboard')
    && fill.context.clipboard === null;
  return { ...result, ok: result.ok && !fill.rules.problem && !clipboardRequired,
    ruleProblem: fill.rules.problem, clipboardRequired };
}

export function recordCopy(state: LocalState, fill: FillSnapshot, values: Readonly<Record<string, string>>, at: string): LocalState {
  if (!renderFill(fill, values).ok) return state;
  const next = structuredClone(state);
  const remembered = reconcileRemembered(fill.prompt, state.remembered[fill.prompt.id] ?? {});
  for (const variable of fill.inputs) {
    // Define an own property because valid names such as __proto__ would otherwise invoke an inherited setter.
    if (variable.rememberLast && Object.hasOwn(values, variable.name)) Object.defineProperty(remembered, variable.name, { value: values[variable.name] ?? '', enumerable: true, writable: true, configurable: true });
  }
  next.remembered[fill.prompt.id] = remembered;
  next.usage[fill.prompt.id] = { count: (state.usage[fill.prompt.id]?.count ?? 0) + 1, lastUsedAt: at };
  return next;
}

export function reconcileRemembered(prompt: Prompt, remembered: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(remembered).filter(([name]) => prompt.variables.some(v => v.name === name && v.rememberLast)));
}
