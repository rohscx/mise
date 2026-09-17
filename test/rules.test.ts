import { describe, expect, it, vi } from 'vitest';
import { captureNames, evaluateRules, matchesPattern, urlAccessor, validMatchPattern, validRule } from '../src/core/rules.js';
import { context, exampleUrl, execute, library } from './fixtures.js';

describe('site rules and accessors', () => {
  it.each(['OPS', 'WEB', 'SEC', 'PLAT'])('derives queue and browse URLs for %s (4, 31)', async project => {
    for (const path of [`projects/${project}/queues/custom/43/${project}-4821`, `browse/${project}-4821`]) {
      const result = await evaluateRules(library().siteRules, `https://jira.example.com/${path}?view=activity#fragment`, execute);
      expect(result).toMatchObject({ captures: { project, ticket: `${project}-4821` }, problem: null });
    }
  });
  it('rejects a mismatched queue project (5)', async () => {
    expect(await evaluateRules(library().siteRules, exampleUrl.replace('/OPS/', '/WEB/'), execute))
      .toEqual({ ruleId: null, captures: {}, problem: null });
  });
  it('uses first successful rule, skips regex failures, and never merges captures', async () => {
    const rules = [
      { id: 'miss', match: 'https://*/*', regex: '^nomatch$', flags: '' },
      { id: 'first', match: 'https://*/*', regex: '(?<one>https)(?<optional>absent)?', flags: '' },
      { id: 'second', match: 'https://*/*', regex: '(?<two>https)', flags: '' },
    ] satisfies Parameters<typeof evaluateRules>[0];
    expect(await evaluateRules(rules, exampleUrl, execute)).toEqual({ ruleId: 'first', captures: { one: 'https' }, problem: null });
    expect((await evaluateRules([{ ...rules[0], id: 'case', match: 'https://*/*', regex: 'HTTPS', flags: 'i' }], exampleUrl, execute)).ruleId).toBe('case');
  });
  it('ignores an invalid rule for another site before resolving a matching rule', async () => {
    const invalid = { id: 'invalid', match: 'https://other.example.com/*', regex: '(', flags: '' } satisfies Parameters<typeof evaluateRules>[0][number];
    const result = await evaluateRules([invalid, ...library().siteRules], exampleUrl, execute);
    expect(result).toEqual({ ruleId: 'jira-queue', captures: { project: 'OPS', ticket: 'OPS-4821' }, problem: null });
  });
  it('handles hostname, encoded path, first decoded query value, missing and empty (6)', () => {
    const url = 'https://jira.example.com:8443/a%20b?name=one+two&name=second&empty=&NAME=upper#frag';
    expect(urlAccessor('url.host', url)).toBe('jira.example.com');
    expect(urlAccessor('url.path', url)).toBe('/a%20b');
    expect(urlAccessor('url.param:name', url)).toBe('one two');
    expect(urlAccessor('url.param:NAME', url)).toBe('upper');
    expect(urlAccessor('url.param:empty', url)).toBe('');
    expect(urlAccessor('url.param:missing', url)).toBeNull();
    expect(urlAccessor('url.host', 'not a URL')).toBeNull();
  });
  it('restricts patterns to supported HTTP(S) Chrome syntax', () => {
    for (const pattern of ['<all_urls>', 'file:///*', 'ftp://*/*', 'https://foo.*/*', 'https://foo:65536/*', 'https://user@foo/*', 'https://foo']) {
      expect(validMatchPattern(pattern), pattern).toBe(false);
    }
    expect(matchesPattern('*://*.example.com/*', 'http://example.com:8080/path?q=yes#x')).toBe(true);
    expect(matchesPattern('*://*.example.com/*', 'https://sub.example.com/path')).toBe(true);
    expect(matchesPattern('*://*.example.com/*', 'https://badexample.com/path')).toBe(false);
    expect(matchesPattern('*://*/*', 'ftp://example.com/a')).toBe(false);
    expect(matchesPattern('https://github.com/*/*/pull/*', 'https://github.com/a/b/pull/42')).toBe(true);
    expect(matchesPattern('https://example.com/*?a=*', 'https://example.com/path?a=one#frag')).toBe(true);
  });
  it('supports Chromium ports, canonical hosts and IPv6 without regex globs', () => {
    expect(matchesPattern('http://localhost:8080/*', 'http://localhost:8080/a')).toBe(true);
    expect(matchesPattern('http://localhost:8080/*', 'http://localhost/a')).toBe(false);
    expect(matchesPattern('https://[::1]:443/*', 'https://[::1]/a')).toBe(true);
    expect(matchesPattern('https://EXAMPLE.com./foo/*', 'https://example.com/foo')).toBe(true);
    expect(matchesPattern('https://bücher.example/*', 'https://xn--bcher-kva.example/a')).toBe(true);
    expect(matchesPattern('https://example.com/' + '*a'.repeat(100) + 'b', 'https://example.com/' + 'a'.repeat(1000))).toBe(false);
  });
  it('recognizes ECMAScript capture identifiers and escaped reserved names', async () => {
    expect(validRule({ id: 'a', match: 'https://*/*', regex: String.raw`(?<\u0075rl>x)`, flags: '' })).toBe(false);
    const rule = { id: 'a', match: 'https://*/*', regex: '(?<名>https)', flags: '' } satisfies Parameters<typeof evaluateRules>[0][number];
    expect((await evaluateRules([rule], exampleUrl, execute)).captures).toEqual({ 名: 'https' });
  });
  it('validates regexes and reserved capture names', () => {
    for (const regex of ['(', '(?<url>x)', '(?<selection>x)']) {
      expect(validRule({ id: 'a', match: 'https://*/*', regex, flags: '' })).toBe(false);
    }
    expect(captureNames(String.raw`\(?<fake>[(?<alsofake>)](?<real>x)(?<=y)`)).toEqual(['real']);
  });
  it('rejects oversized URLs before worker execution', async () => {
    const executor = vi.fn(execute);
    expect((await evaluateRules(library().siteRules, context().source.url + 'é'.repeat(8192), executor)).problem?.code).toBe('url-size');
    expect(executor).not.toHaveBeenCalled();
  });
  it('terminates pathological regex and blocks without falling through (29)', async () => {
    const rules = [{ id: 'bad', match: 'https://*/*', regex: '(a+)+$', flags: '' }] satisfies Parameters<typeof evaluateRules>[0];
    expect((await evaluateRules(rules, 'https://example.com/' + 'a'.repeat(100) + '!', execute)).problem)
      .toEqual({ code: 'timeout', ruleId: 'bad' });
  }, 2000);
  it('terminates successful and failed jobs', async () => {
    const terminate = vi.fn();
    const rules = library().siteRules;
    await evaluateRules(rules, exampleUrl, () => ({ result: Promise.resolve({}), terminate }));
    expect(terminate).toHaveBeenCalledOnce();
    expect((await evaluateRules(rules, exampleUrl, () => ({ result: Promise.reject(new Error('failed')), terminate }))).problem?.code).toBe('worker');
  });
});
