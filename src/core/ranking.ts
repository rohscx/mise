import type { ExportFile, Prompt, Usage } from '../shared/types.js';
import { expandTemplate, renderTemplate } from './template.js';
import { matchesPattern } from './rules.js';

export interface RankedPrompt { prompt: Prompt; score: number; scoped: boolean }

function fieldScore(term: string, field: string): number {
  if (field === term) return 4;
  if (field.startsWith(term)) return 3;
  if (field.includes(term)) return 2;
  let cursor = 0;
  for (const char of field) if (char === term[cursor]) cursor++;
  return cursor === term.length ? 1 : 0;
}
function compare(a: string, b: string): number {
  const left = Array.from(a, c => c.codePointAt(0) ?? 0);
  const right = Array.from(b, c => c.codePointAt(0) ?? 0);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference) return difference;
  }
  return left.length - right.length;
}

export function rankPrompts(library: ExportFile, query: string, activeUrl: string | null,
  usage: Readonly<Record<string, Usage>> = {}): RankedPrompt[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const ranked: RankedPrompt[] = [];
  for (const prompt of library.prompts) {
    const expanded = expandTemplate(prompt.body, { kind: 'prompt', name: prompt.id }, library.partials);
    const body = renderTemplate(expanded, name => `{{${name}}}`).output;
    const fields = [prompt.name, prompt.body, body, ...prompt.tags].map(s => s.toLowerCase());
    const scores = terms.map(term => Math.max(...fields.map(field => fieldScore(term, field))));
    if (scores.some(score => score === 0)) continue;
    ranked.push({ prompt, score: scores.reduce((a, b) => a + b, 0),
      scoped: activeUrl !== null && prompt.scope.some(pattern => matchesPattern(pattern, activeUrl)) });
  }
  const used = (id: string): number => {
    const value = usage[id]?.lastUsedAt;
    return value ? Date.parse(value) : -Infinity;
  };
  return ranked.sort((a, b) => Number(b.scoped) - Number(a.scoped) || b.score - a.score
    || (used(a.prompt.id) === used(b.prompt.id) ? 0 : used(a.prompt.id) > used(b.prompt.id) ? -1 : 1)
    || (usage[b.prompt.id]?.count ?? 0) - (usage[a.prompt.id]?.count ?? 0)
    || compare(a.prompt.name, b.prompt.name) || compare(a.prompt.id, b.prompt.id));
}
