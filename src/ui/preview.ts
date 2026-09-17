import { renderFill } from '../core/resolve.js';
import type { FillSnapshot, FillResult } from '../core/resolve.js';
import type { Expansion, Problem } from '../core/template.js';

export type ValueKind = 'text' | 'context' | 'derived' | 'free' | 'unresolved';
export interface Annotation { text: string; kind: ValueKind; label: string }
function location(problem: Problem): string {
  return `${problem.origin.kind} ${problem.origin.name}, offset ${problem.offset}: ${problem.code} (${problem.path.join(' → ')})`;
}
export function annotations(fill: FillSnapshot, values: Readonly<Record<string, string>>,
  result: FillResult = renderFill(fill, values)): Annotation[] {
  const output: Annotation[] = [];
  let size = 0;
  let steps = 0;
  let limited = false;
  const push = (part: Annotation): void => { size += part.text.length; output.push(part); };
  const visit = (branches: Expansion['branches'], origin: { kind: string; name: string }): void => {
    // Expansion omits invalid includes and syntax; merge their diagnostics back at source offsets.
    const missing = fill.expansion.problems.filter(p => p.origin.kind === origin.kind && p.origin.name === origin.name);
    const entries = [...branches.map(branch => ({ offset: branch.token.offset, branch, problem: null })),
      ...missing.map(problem => ({ offset: problem.offset, branch: null, problem }))].sort((a, b) => a.offset - b.offset);
    for (const entry of entries) {
      if (++steps > 20000 || size > 1024 * 1024) {
        if (!limited) push({ text: '\nPreview limit reached. Shorten the prompt or its partials.', kind: 'unresolved', label: 'Preview limit' });
        limited = true; return;
      }
      if (entry.problem) {
        const p = entry.problem;
        push({ text: p.code === 'syntax' ? p.token : `{{> ${p.token}}}`, kind: 'unresolved', label: location(p) });
        continue;
      }
      const branch = entry.branch;
      if (!branch) continue;
      const t = branch.token;
      if (branch.children) { visit(branch.children, { kind: 'partial', name: t.value }); continue; }
      if (t.kind === 'text') { push({ text: t.value, kind: 'text', label: '' }); continue; }
      const problem = result.problems.find(p => p.code === 'unresolved' && p.token === t.value
        && p.offset === t.offset && p.origin.kind === t.origin.kind && p.origin.name === t.origin.name);
      if (problem) { push({ text: `{{${t.value}}}`, kind: 'unresolved', label: location(problem) }); continue; }
      const kind: ValueKind = fill.inputs.some(v => v.name === t.value) ? 'free'
        : Object.hasOwn(fill.rules.captures, t.value) ? 'derived' : 'context';
      const text = renderFill({ ...fill, expansion: { tokens: [t], branches: [branch], problems: [] } }, values).output;
      push({ text, kind, label: `${kind}: ${t.value}` });
    }
  };
  visit(fill.expansion.branches, { kind: 'prompt', name: fill.prompt.id });
  return output;
}
export function renderPreview(target: HTMLElement, parts: readonly Annotation[]): void {
  target.replaceChildren(...parts.map(part => {
    const span = document.createElement('span');
    span.textContent = part.text;
    span.className = part.kind;
    if (part.label) { span.title = part.label; span.setAttribute('aria-label', `${part.text} — ${part.label}`); }
    return span;
  }));
}
export function fillErrors(result: FillResult): string {
  const errors = result.problems.map(p => `${p.token}: ${location(p)}`);
  if (result.ruleProblem) errors.push(`Rule ${result.ruleProblem.ruleId}: ${result.ruleProblem.code}. Choose another source or edit the rule.`);
  if (result.clipboardRequired) errors.push('Read clipboard to supply {{clipboard}}.');
  return errors.join('\n');
}
