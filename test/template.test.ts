import { describe, expect, it } from 'vitest';
import { expandTemplate, MAX_OUTPUT_BYTES, parseTemplate, renderTemplate } from '../src/core/template.js';
import type { PromptPartial } from '../src/shared/types.js';

const origin = { kind: 'prompt', name: 'test' } satisfies Parameters<typeof parseTemplate>[1];
function render(body: string, partials: PromptPartial[] = [], values: Record<string, string> = {}): ReturnType<typeof renderTemplate> {
  return renderTemplate(expandTemplate(body, origin, partials), name => values[name] ?? null);
}

describe('template syntax and plain-text rendering', () => {
  it('handles the full escape table and never reparses substitutions (7)', () => {
    expect(render(String.raw`\{{url}} \\ {{ url }} \x end` + '\\', [], { url: '{{> missing}}\\{{url}}' })).toMatchObject({
      ok: true, output: String.raw`{{url}} \ {{> missing}}\{{url}} \x end` + '\\',
    });
    expect(render(String.raw`\\{{url}}`, [], { url: 'value' }).output).toBe('\\value');
    expect(render('}} literal').output).toBe('}} literal');
    expect(render('{{> escaped}}', [{ name: 'escaped', body: String.raw`\{{url}}` }]).output).toBe('{{url}}');
  });
  it('rejects malformed and unclosed tokens with offsets', () => {
    for (const body of ['x {{', '{{two names}}', '{{> }}', '{{url.param:a b}}', '{{url.other}}', '{{}}']) {
      expect(render(body).problems[0]).toMatchObject({ code: 'syntax', origin });
    }
    expect(render('x {{').problems[0]?.offset).toBe(2);
  });
  it('allows eight levels, rejects nine, and reports full cycles (8)', () => {
    const chain = Array.from({ length: 8 }, (_, i) => ({ name: `p${i}`, body: i === 7 ? 'done' : `{{> p${i + 1}}}` }));
    expect(render('{{> p0}}', chain)).toMatchObject({ ok: true, output: 'done' });
    chain[7] = { name: 'p7', body: '{{> p8}}' };
    chain.push({ name: 'p8', body: 'too deep' });
    expect(render('{{> p0}}', chain).problems[0]).toMatchObject({ code: 'depth', path: ['test', ...chain.map(p => p.name)] });
    expect(render('{{> a}}', [{ name: 'a', body: '{{> b}}' }, { name: 'b', body: '{{> a}}' }]).problems[0])
      .toMatchObject({ code: 'cycle', path: ['test', 'a', 'b', 'a'] });
    expect(render('{{> a}}{{> a}}', [{ name: 'a', body: '{{> b}}' }, { name: 'b', body: 'ok' }]))
      .toMatchObject({ ok: true, output: 'okok' });
  });
  it('names the token and originating partial for unresolved values and missing includes (9)', () => {
    const result = render('{{> a}}', [{ name: 'a', body: '{{missing}} {{> absent}}' }]);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unresolved', token: 'missing', origin: { kind: 'partial', name: 'a' } }),
      expect.objectContaining({ code: 'missing-partial', token: 'absent', path: ['test', 'a', 'absent'] }),
    ]));
  });
  it('shares partial expansions without changing first-appearance requirements or output', () => {
    expect(render('{{> a}}{{> b}}{{> a}}', [{ name: 'a', body: '{{x}}' }, { name: 'b', body: '{{y}}' }], { x: 'X', y: 'Y' }).output).toBe('XYX');
    expect(render('{{名}}', [], { 名: 'value' }).output).toBe('value');
    const partials = Array.from({ length: 8 }, (_, i) => ({ name: `p${i}`, body: i === 7 ? '' : `{{> p${i + 1}}}`.repeat(100) }));
    expect(render('{{> p0}}', partials)).toMatchObject({ ok: true, output: '' });
    partials[7] = { name: 'p7', body: '{{> missing}}' };
    expect(render('{{> p0}}', partials).problems[0]?.code).toBe('missing-partial');
    expect(render('{{> a}}', [{ name: 'a', body: 'a'.repeat(MAX_OUTPUT_BYTES) }]).ok).toBe(true);
  }, 2000);
  it('measures UTF-8 output and bounds pathological expansion', () => {
    expect(render('{{value}}', [], { value: 'a'.repeat(MAX_OUTPUT_BYTES) }).ok).toBe(true);
    expect(render('{{a}}{{b}}', [], { a: 'a'.repeat(MAX_OUTPUT_BYTES - 4) + '\uD83D', b: '\uDE00' }).ok).toBe(true);
    expect(render('{{value}}', [], { value: 'é'.repeat(MAX_OUTPUT_BYTES / 2 + 1) }).problems[0]?.code).toBe('oversize');
    const partials = Array.from({ length: 8 }, (_, i) => ({ name: `p${i}`, body: i === 7 ? 'x'.repeat(1024) : `{{> p${i + 1}}}`.repeat(16) }));
    expect(render('{{> p0}}', partials).problems.some(p => p.code === 'oversize')).toBe(true);
    expect(render('{{> a}}', [{ name: 'a', body: '{{> a}}'.repeat(10) }]).ok).toBe(false);
  }, 3000);
});
