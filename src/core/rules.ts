import type { SiteRule } from '../shared/types.js';

export interface RuleProblem { code: 'invalid-rule' | 'url-size' | 'timeout' | 'worker'; ruleId: string }
export interface RuleResult { ruleId: string | null; captures: Record<string, string>; problem: RuleProblem | null }
export interface RegexJob { result: Promise<Record<string, string> | null>; terminate: () => void }
// The host supplies a disposable worker so a blocked regex cannot block the caller's timer.
export type RegexExecutor = (rule: SiteRule, url: string) => RegexJob;

export function isReserved(name: string): boolean {
  return ['url', 'title', 'selection', 'date', 'clipboard'].includes(name) || name.startsWith('url.');
}

interface MatchPattern { scheme: string; host: string; subdomains: boolean; port: string; path: string }

function parsePattern(pattern: string): MatchPattern | null {
  const match = /^(https?|\*):\/\/([^/]+)(\/[\s\S]*)$/.exec(pattern);
  const scheme = match?.[1], authority = match?.[2], path = match?.[3];
  if (!scheme || !authority || !path) return null;
  const parts = /^(\[[^\]]+\]|[^:]+)(?::(\*|[0-9]+))?$/.exec(authority);
  const rawHost = parts?.[1], port = parts?.[2] ?? '*';
  if (!rawHost || (port !== '*' && Number(port) > 65535)) return null;
  const subdomains = rawHost === '*' || rawHost.startsWith('*.');
  if (rawHost === '*') return { scheme, host: '', subdomains, port, path };
  const plain = subdomains ? rawHost.slice(2) : rawHost;
  if (!plain || /[*@?#\s\\]/.test(plain)) return null;
  try {
    const host = new URL(`https://${plain}/`).hostname.replace(/\.$/, '');
    return host ? { scheme, host, subdomains, port, path } : null;
  } catch { return null; }
}

export function validMatchPattern(pattern: string): boolean {
  return parsePattern(pattern) !== null;
}

function matchesPath(pattern: string, path: string): boolean {
  if (pattern === `${path}/*`) return true;
  const parts = pattern.split('*');
  if (parts.length === 1) return pattern === path;
  const first = parts[0] ?? '', last = parts[parts.length - 1] ?? '';
  if (!path.startsWith(first) || !path.endsWith(last)) return false;
  let position = first.length;
  // Literal segment search avoids backtracking regexes for untrusted match-pattern globs.
  for (const part of parts.slice(1, -1)) {
    const found = path.indexOf(part, position);
    if (found < 0) return false;
    position = found + part.length;
  }
  return position <= path.length - last.length;
}

export function matchesPattern(pattern: string, input: string): boolean {
  const parsed = parsePattern(pattern);
  if (!parsed) return false;
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)
      || (parsed.scheme !== '*' && `${parsed.scheme}:` !== url.protocol)) return false;
    const host = url.hostname.replace(/\.$/, '');
    const ip = host.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(host);
    if (parsed.host && host !== parsed.host
      && !(parsed.subdomains && !ip && host.endsWith(`.${parsed.host}`))) return false;
    const port = url.port || (url.protocol === 'http:' ? '80' : '443');
    if (parsed.port !== '*' && parsed.port !== port) return false;
    return matchesPath(parsed.path, url.pathname + url.search);
  } catch { return false; }
}

export function urlAccessor(name: string, input: string): string | null {
  try {
    const url = new URL(input);
    if (name === 'url.host') return url.hostname;
    if (name === 'url.path') return url.pathname;
    if (/^url\.param:[A-Za-z0-9_.~-]+$/.test(name)) return url.searchParams.get(name.slice(10));
  } catch { return null; }
  return null;
}

export function captureNames(regex: string): string[] {
  const names: string[] = [];
  let inClass = false;
  for (let i = 0; i < regex.length; i++) {
    if (regex[i] === '\\') { i++; continue; }
    if (regex[i] === '[') inClass = true;
    if (regex[i] === ']') inClass = false;
    if (!inClass && regex.startsWith('(?<', i) && !['=', '!'].includes(regex[i + 3] ?? '')) {
      const end = regex.indexOf('>', i + 3);
      if (end >= 0) {
        const name = regex.slice(i + 3, end).replace(/\\u(?:\{([0-9a-fA-F]+)\}|([0-9a-fA-F]{4}))/g,
          (_match: string, braced: string | undefined, fixed: string | undefined): string => {
            const point = Number.parseInt(braced ?? fixed ?? '', 16);
            return point <= 0x10ffff ? String.fromCodePoint(point) : '';
          });
        names.push(name);
      }
    }
  }
  return names;
}

export function validRule(rule: SiteRule): boolean {
  if (!validMatchPattern(rule.match) || !['', 'i'].includes(rule.flags) || !rule.regex || [...rule.regex].length > 4096) return false;
  try { new RegExp(rule.regex, rule.flags); } catch { return false; }
  return captureNames(rule.regex).every(n => !isReserved(n));
}

export async function evaluateRules(rules: readonly SiteRule[], url: string, execute: RegexExecutor): Promise<RuleResult> {
  const empty: RuleResult = { ruleId: null, captures: {}, problem: null };
  if (new TextEncoder().encode(url).length > 16 * 1024) return { ...empty, problem: { code: 'url-size', ruleId: '' } };
  const deadline = performance.now() + 100;
  for (const rule of rules) {
    if (!validRule(rule)) return { ...empty, problem: { code: 'invalid-rule', ruleId: rule.id } };
    if (!matchesPattern(rule.match, url)) continue;
    let job: RegexJob | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const remaining = deadline - performance.now();
      if (remaining <= 0) return { ...empty, problem: { code: 'timeout', ruleId: rule.id } };
      job = execute(rule, url);
      const outcome = await Promise.race([
        job.result.then(captures => ({ captures })),
        new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), Math.max(0, deadline - performance.now())); }),
      ]);
      if (outcome === 'timeout') return { ...empty, problem: { code: 'timeout', ruleId: rule.id } };
      if (outcome.captures !== null) return { ruleId: rule.id, captures: outcome.captures, problem: null };
    } catch { return { ...empty, problem: { code: 'worker', ruleId: rule.id } }; }
    finally { if (timer !== undefined) clearTimeout(timer); job?.terminate(); }
  }
  return empty;
}
