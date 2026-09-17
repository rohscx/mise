import { evaluateRules, validMatchPattern, validRule } from '../core/rules.js';
import type { RegexExecutor } from '../core/rules.js';
import type { SiteRule } from '../shared/types.js';

export function moveRule(rules: readonly SiteRule[], index: number, direction: -1 | 1): SiteRule[] {
  const next = [...rules];
  const target = index + direction;
  const item = next[index], other = next[target];
  if (item && other) { next[index] = other; next[target] = item; }
  return next;
}
export type UrlTest = { kind: 'captures'; captures: Record<string, string> }
  | { kind: 'no-match' } | { kind: 'error'; message: string };
export async function testRule(rule: SiteRule, input: string, execute: RegexExecutor): Promise<UrlTest> {
  if (!validMatchPattern(rule.match)) return { kind: 'error', message: `${rule.id}: Invalid URL pattern` };
  try { new RegExp(rule.regex, rule.flags); }
  catch { return { kind: 'error', message: `${rule.id}: Invalid regex` }; }
  if (!validRule(rule)) return { kind: 'error', message: `${rule.id}: Invalid flags, regex length, or reserved capture name` };
  if (new TextEncoder().encode(input).length > 16 * 1024) return { kind: 'error', message: `${rule.id}: URL exceeds 16 KiB` };
  let url: URL;
  try { url = new URL(input); } catch { return { kind: 'error', message: 'Enter an absolute HTTP(S) URL' }; }
  if (!['https:', 'http:'].includes(url.protocol)) return { kind: 'error', message: 'Enter an HTTP(S) URL' };
  const result = await evaluateRules([rule], url.href, execute);
  if (result.problem) return { kind: 'error', message: `${rule.id}: ${result.problem.code}` };
  return result.ruleId === null ? { kind: 'no-match' } : { kind: 'captures', captures: result.captures };
}
export function testResultText(result: UrlTest): string {
  if (result.kind === 'error') return result.message;
  if (result.kind === 'no-match') return 'No match';
  const entries = Object.entries(result.captures);
  return entries.length ? entries.map(([name, value]) => `${name} = ${value}`).join('\n') : 'Matched; no named captures';
}
