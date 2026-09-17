import type { PromptPartial } from '../shared/types.js';

export const MAX_OUTPUT_BYTES = 1024 * 1024;
export interface Origin { kind: 'prompt' | 'partial'; name: string }
export interface Problem {
  code: 'syntax' | 'unresolved' | 'missing-partial' | 'cycle' | 'depth' | 'oversize';
  token: string;
  origin: Origin;
  offset: number;
  path: string[];
}
export interface Token {
  kind: 'text' | 'variable' | 'include';
  value: string;
  origin: Origin;
  offset: number;
}
export interface ParsedTemplate { tokens: Token[]; problems: Problem[] }
interface Branch { token: Token; children: Branch[] | null }
export interface Expansion extends ParsedTemplate { branches: Branch[] }
export interface RenderResult { output: string; problems: Problem[]; ok: boolean }
const identifier = /^[$_\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*$/u;

export function isVariableName(name: string): boolean {
  return identifier.test(name) || /^url\.(host|path|param:[A-Za-z0-9_.~-]+)$/.test(name);
}

export function parseTemplate(body: string, origin: Origin): ParsedTemplate {
  const tokens: Token[] = [];
  const problems: Problem[] = [];
  let literal = '';
  let start = 0;
  const flush = (): void => {
    if (literal) tokens.push({ kind: 'text', value: literal, origin, offset: start });
    literal = '';
  };
  for (let i = 0; i < body.length;) {
    if (!literal) start = i;
    if (body.startsWith('\\{{', i)) { literal += '{{'; i += 3; }
    else if (body.startsWith('\\\\', i)) { literal += '\\'; i += 2; }
    else if (body.startsWith('{{', i)) {
      flush();
      const end = body.indexOf('}}', i + 2);
      const raw = body.slice(i, end < 0 ? body.length : end + 2);
      const value = body.slice(i + 2, end < 0 ? body.length : end).trim();
      const include = value.startsWith('>');
      const name = include ? value.slice(1).trim() : value;
      if (end < 0 || !(include ? /^[a-z][a-z0-9-]{0,63}$/.test(name) : isVariableName(name))) {
        problems.push({ code: 'syntax', token: raw, origin, offset: i, path: [origin.name] });
      } else tokens.push({ kind: include ? 'include' : 'variable', value: name, origin, offset: i });
      i = end < 0 ? body.length : end + 2;
    } else { literal += body[i]; i++; }
  }
  flush();
  return { tokens, problems };
}

export function expandTemplate(body: string, origin: Origin, partials: readonly PromptPartial[]): Expansion {
  const tokens: Token[] = [];
  const problems: Problem[] = [];
  const byName = new Map(partials.map(p => [p.name, p]));
  const parsed = new Map<string, ParsedTemplate>();
  const expanded = new Map<string, Branch[]>();
  const seen = new Set<Token>();
  const visit = (text: string, source: Origin, stack: string[], depth: number): Branch[] => {
    const key = `${source.kind}:${source.name}`;
    const cacheKey = `${key}:${depth}`;
    const cached = expanded.get(cacheKey);
    if (cached) return cached;
    const syntax = parsed.get(key) ?? parseTemplate(text, source);
    parsed.set(key, syntax);
    for (const problem of syntax.problems) problems.push({ ...problem, path: origin.kind === 'partial' ? stack : [origin.name, ...stack] });
    const branches: Branch[] = [];
    for (const token of syntax.tokens) {
      if (token.kind !== 'include') {
        if (!seen.has(token)) { tokens.push(token); seen.add(token); }
        branches.push({ token, children: null });
        continue;
      }
      const path = [...(origin.kind === 'partial' ? stack : [origin.name, ...stack]), token.value];
      const partial = byName.get(token.value);
      const code = !partial ? 'missing-partial' : stack.includes(token.value) ? 'cycle' : depth >= 8 ? 'depth' : null;
      if (code) problems.push({ code, token: token.value, origin: source, offset: token.offset, path });
      else if (partial) branches.push({ token, children:
        visit(partial.body, { kind: 'partial', name: partial.name }, [...stack, partial.name], depth + 1) });
    }
    // Share subtrees and report their first failing path to bound even invalid branching graphs.
    expanded.set(cacheKey, branches);
    return branches;
  };
  const branches = visit(body, origin, origin.kind === 'partial' ? [origin.name] : [], origin.kind === 'partial' ? 1 : 0);
  return { tokens, problems, branches };
}

export function renderTemplate(expansion: Expansion, resolve: (name: string) => string | null): RenderResult {
  const problems = [...expansion.problems];
  const cache = new Map<Branch[], { output: string; bytes: number }>();
  const values = new Map<string, string | null>();
  let oversized = false;
  const visit = (branches: Branch[], path: string[]): { output: string; bytes: number } => {
    const cached = cache.get(branches);
    if (cached) return cached;
    const parts: string[] = [];
    let bytes = 0;
    let lastCodeUnit = 0;
    for (const branch of branches) {
      const { token, children } = branch;
      let value: { output: string; bytes: number };
      if (children) value = visit(children, [...path, token.value]);
      else {
        if (token.kind === 'variable' && !values.has(token.value)) values.set(token.value, resolve(token.value));
        const resolved = token.kind === 'text' ? token.value : values.get(token.value) ?? null;
        if (resolved === null) {
          problems.push({ code: 'unresolved', token: token.value, origin: token.origin, offset: token.offset, path });
          continue;
        }
        value = { output: resolved, bytes: new TextEncoder().encode(resolved).length };
      }
      if (oversized) break;
      // Adjacent substitutions can join a surrogate pair that encoded separately as replacements.
      const firstCodeUnit = value.output.charCodeAt(0);
      const joinedPair = lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff
        && firstCodeUnit >= 0xdc00 && firstCodeUnit <= 0xdfff;
      const addedBytes = value.bytes - (joinedPair ? 2 : 0);
      if (bytes + addedBytes > MAX_OUTPUT_BYTES) {
        problems.push({ code: 'oversize', token: token.value, origin: token.origin, offset: token.offset, path });
        oversized = true;
        break;
      }
      bytes += addedBytes;
      if (value.output) lastCodeUnit = value.output.charCodeAt(value.output.length - 1);
      parts.push(value.output);
    }
    const result = { output: parts.join(''), bytes };
    cache.set(branches, result);
    return result;
  };
  const rootName = expansion.branches[0]?.token.origin.name;
  const result = visit(expansion.branches, rootName ? [rootName] : []);
  return { output: result.output, problems, ok: problems.length === 0 };
}
