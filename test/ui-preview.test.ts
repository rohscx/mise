import { describe, expect, it } from 'vitest';
import { prepareFill, renderFill } from '../src/core/resolve.js';
import { annotations, fillErrors } from '../src/ui/preview.js';
import { inputValues } from '../src/ui/interaction.js';
import { context, execute, library, prompt } from './fixtures.js';

describe('annotated fill preview', () => {
  it('restores unresolved tokens at their source position, including repeated partials', async () => {
    const lib = library(); lib.siteRules = [];
    lib.partials = [{ name: 'gap', body: 'before {{selection}} after' }];
    const selected = { ...prompt('review-github-pr'), body: 'A {{> gap}} B {{> gap}} C' };
    const fill = await prepareFill(selected, lib, context(), {}, execute);
    expect(renderFill(fill).output).toBe('A before  after B before  after C');
    const parts = annotations(fill, fill.values);
    expect(parts.map(p => p.text).join('')).toBe('A before {{selection}} after B before {{selection}} after C');
    expect(parts.filter(p => p.kind === 'unresolved')).toEqual([
      { text: '{{selection}}', kind: 'unresolved', label: 'partial gap, offset 7: unresolved (review-github-pr → gap)' },
      { text: '{{selection}}', kind: 'unresolved', label: 'partial gap, offset 7: unresolved (review-github-pr → gap)' },
    ]);
  });
  it('labels context, URL-derived rule values, and free input separately', async () => {
    const selected = { ...prompt('review-github-pr'), body: '{{url}}|{{project}}|{{focus}}|{{url.host}}' };
    const fill = await prepareFill(selected, library(), context(), {}, execute);
    expect(annotations(fill, fill.values).filter(p => p.kind !== 'text').map(p => [p.kind, p.label])).toEqual([
      ['context', 'context: url'], ['derived', 'derived: project'], ['free', 'free: focus'], ['context', 'context: url.host'],
    ]);
  });
  it('preserves literal escapes and untrusted substitutions without reparsing', async () => {
    const lib = library(); lib.siteRules = [];
    const selected = { ...prompt('review-github-pr'), body: '\\{{literal}} {{focus}}' };
    const fill = await prepareFill(selected, lib, context(), {}, execute);
    const values = inputValues([['focus', '<img src=x onerror=alert(1)>{{url}}']]);
    expect(annotations(fill, values).map(p => p.text).join('')).toBe(renderFill(fill, values).output);
  });
  it('restores missing includes and malformed tokens with origin diagnostics', async () => {
    const lib = library(); lib.siteRules = [];
    const selected = { ...prompt('review-github-pr'), body: 'a {{> absent}} b {{bad token}} c' };
    const fill = await prepareFill(selected, lib, context(), {}, execute);
    expect(annotations(fill, fill.values).map(p => p.text).join('')).toBe(selected.body);
    expect(fillErrors(renderFill(fill))).toContain('prompt review-github-pr, offset 2: missing-partial');
    expect(renderFill(fill).ok).toBe(false);
  });
  it('keeps __proto__ as a free input own property through a real fill', async () => {
    const selected = prompt('review-github-pr'); selected.body = '{{__proto__}}';
    selected.variables = [{ kind: 'free', name: '__proto__', label: 'Value', defaultValue: '', rememberLast: true }];
    const lib = library(); lib.siteRules = [];
    const fill = await prepareFill(selected, lib, context(), {}, execute);
    const values = inputValues([['__proto__', 'safe own value']]);
    expect(Object.getPrototypeOf(values)).toBeNull();
    expect(Object.hasOwn(values, '__proto__')).toBe(true);
    expect(renderFill(fill, values)).toMatchObject({ ok: true, output: 'safe own value' });
    expect(annotations(fill, values)[0]?.kind).toBe('free');
  });
  it('maps clipboard and rule failures to actionable messages', async () => {
    const lib = library(); lib.siteRules = [];
    const fill = await prepareFill({ ...prompt('review-github-pr'), body: '{{clipboard}}' }, lib, context(), {}, execute);
    const result = renderFill(fill);
    expect(fillErrors(result)).toContain('Read clipboard');
    expect(fillErrors({ ...result, ruleProblem: { code: 'timeout', ruleId: 'slow-rule' } })).toContain('Rule slow-rule: timeout');
  });
  it('rebuilding from a changed source updates annotation text', async () => {
    const lib = library(); lib.siteRules = [];
    const selected = { ...prompt('review-github-pr'), body: '{{url}}' };
    const first = await prepareFill(selected, lib, context('https://one.example/'), {}, execute);
    const second = await prepareFill(selected, lib, context('https://two.example/'), {}, execute);
    expect(annotations(first, {})[0]?.text).toBe('https://one.example/');
    expect(annotations(second, {})[0]?.text).toBe('https://two.example/');
  });
  it('marks a bounded preview as unresolved so Copy cannot use a truncated view', async () => {
    const lib = library(); lib.siteRules = [];
    const selected = { ...prompt('review-github-pr'), body: '{{focus}}'.repeat(20001) };
    const fill = await prepareFill(selected, lib, context(), {}, execute);
    const parts = annotations(fill, fill.values);
    expect(parts.at(-1)).toMatchObject({ kind: 'unresolved', label: 'Preview limit' });
    expect(parts.length).toBeLessThanOrEqual(20001);
  });
  it('matches the complete valid example body exactly when annotation text is joined', async () => {
    const fill = await prepareFill(prompt('implement-ticket'), library(), context(), {}, execute);
    expect(annotations(fill, fill.values).map(part => part.text).join('')).toBe(renderFill(fill).output);
  });

});
