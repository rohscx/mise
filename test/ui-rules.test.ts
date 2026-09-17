import { describe, expect, it, vi } from 'vitest';
import type { RegexExecutor } from '../src/core/rules.js';
import { moveRule, testResultText, testRule } from '../src/ui/rules-ui.js';
import { execute } from './fixtures.js';

const rule = { id: 'ticket', match: 'https://example.com/*', regex: '/(?<ticket>OPS-[0-9]+)$', flags: '' as const };
describe('options rule ordering and URL tester', () => {
  it('moves rules without mutating the original and leaves boundaries and missing indexes alone', () => {
    const rules = [rule, { ...rule, id: 'second' }, { ...rule, id: 'third' }];
    expect(moveRule(rules, 0, -1)).toEqual(rules);
    expect(moveRule(rules, 2, 1)).toEqual(rules);
    expect(moveRule(rules, -1, 1)).toEqual(rules);
    expect(moveRule([], 0, 1)).toEqual([]);
    expect(moveRule(rules, 0, 1).map(r => r.id)).toEqual(['second', 'ticket', 'third']);
    expect(moveRule(rules, 2, -1).map(r => r.id)).toEqual(['ticket', 'third', 'second']);
    expect(rules.map(r => r.id)).toEqual(['ticket', 'second', 'third']);
  });
  it('reports captures through a disposable real worker and distinguishes regex no-match', async () => {
    expect(await testRule(rule, 'https://example.com/OPS-42', execute)).toEqual({ kind: 'captures', captures: { ticket: 'OPS-42' } });
    expect(await testRule(rule, 'https://example.com/no-ticket', execute)).toEqual({ kind: 'no-match' });
  });
  it('does not run the regex for a pattern mismatch or invalid input', async () => {
    const never: RegexExecutor = (): never => { throw new Error('Should not execute'); };
    expect(await testRule(rule, 'https://other.com/OPS-42', never)).toEqual({ kind: 'no-match' });
    expect(await testRule({ ...rule, regex: '(' }, 'https://other.com/OPS-42', never)).toEqual({ kind: 'error', message: 'ticket: Invalid regex' });
    expect(await testRule({ ...rule, match: '<all_urls>' }, 'https://example.com/', never)).toMatchObject({ kind: 'error', message: 'ticket: Invalid URL pattern' });
    expect(await testRule(rule, 'file:///private', never)).toMatchObject({ kind: 'error' });
    expect(await testRule(rule, 'bad url', never)).toMatchObject({ kind: 'error' });
    expect(await testRule(rule, `https://example.com/${'x'.repeat(17000)}`, never)).toMatchObject({ kind: 'error', message: 'ticket: URL exceeds 16 KiB' });
  });
  it('surfaces timeouts and terminates the job', async () => {
    const terminate = vi.fn();
    const stalled: RegexExecutor = () => ({ ready: Promise.resolve(), result: new Promise(() => undefined), terminate });
    expect(await testRule(rule, 'https://example.com/OPS-42', stalled)).toEqual({ kind: 'error', message: 'ticket: timeout' });
    expect(terminate).toHaveBeenCalledOnce();
  });
  it('serializes the URL before evaluation and keeps result statuses distinct', async () => {
    let received = '';
    const observe: RegexExecutor = (_rule, url) => { received = url; return { ready: Promise.resolve(), result: Promise.resolve({}), terminate: (): void => undefined }; };
    expect(testResultText(await testRule(rule, 'https://EXAMPLE.com:443/a b', observe))).toBe('Matched; no named captures');
    expect(received).toBe('https://example.com/a%20b');
    expect(testResultText({ kind: 'no-match' })).toBe('No match');
    expect(testResultText({ kind: 'captures', captures: { ticket: 'OPS-42' } })).toBe('ticket = OPS-42');
    expect(testResultText({ kind: 'error', message: 'ticket: timeout' })).toBe('ticket: timeout');
  });
});
