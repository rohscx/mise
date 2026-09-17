import type { Prompt } from '../src/shared/types.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { prepareFill, reconcileRemembered, recordCopy, renderFill } from '../src/core/resolve.js';
import { context, exampleUrl, execute, library, prompt, state } from './fixtures.js';

async function fill(body: string, source = context()): Promise<ReturnType<typeof renderFill>> {
  const selected = { ...prompt('implement-ticket'), body };
  return renderFill(await prepareFill(selected, library(), source, {}, execute));
}

describe('fill pipeline', () => {
  it('reproduces the normative worked example byte for byte (3)', async () => {
    const spec = readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8');
    const expected = spec.split('With the example URL, the exact rendered body is:\n\n```text\n')[1]?.split('\n```')[0];
    expect(expected).toBeDefined();
    const selected = prompt('implement-ticket');
    const result = renderFill(await prepareFill(selected, library(), context(), {}, execute));
    expect(result.ok).toBe(true);
    expect(result.output).toBe(expected);
    expect(result.output.endsWith('\n')).toBe(false);
  });
  it.each(['OPS', 'WEB', 'SEC', 'PLAT'])('fills ticket-summary from both %s shapes (4, 31)', async project => {
    for (const path of [`projects/${project}/queues/custom/43/${project}-4821`, `browse/${project}-4821`]) {
      const result = renderFill(await prepareFill(prompt('ticket-summary'), library(), context(`https://jira.example.com/${path}`), {}, execute));
      expect(result.ok).toBe(true);
      expect(result.output).toContain(`Summarize ${project}-4821 in project ${project} as of 2026-09-17.`);
    }
  });
  it('blocks mismatched project captures and missing partials (5, 9)', async () => {
    const result = renderFill(await prepareFill(prompt('ticket-summary'), library(), context(exampleUrl.replace('/OPS/', '/WEB/')), {}, execute));
    expect(result.ok).toBe(false);
    expect(result.problems.map(p => p.token)).toEqual(['ticket', 'project']);
    expect((await fill('{{> missing}}')).ok).toBe(false);
  });
  it('handles null versus empty context and query values (6, 14, 24 pure portion)', async () => {
    expect((await fill('{{selection}}')).ok).toBe(false);
    const captured = context(exampleUrl + '?x=&x=second#frag');
    captured.source.selection = '';
    captured.source.source = 'link';
    expect(await fill('{{selection}}|{{url.param:x}}|{{url}}', captured))
      .toMatchObject({ ok: true, output: '||' + captured.source.url });
    expect((await fill('{{url.param:missing}}', captured)).problems[0]?.code).toBe('unresolved');
    expect(await fill('{{title}}', captured)).toMatchObject({ ok: false });
    expect(await fill('{{clipboard}}')).toMatchObject({ ok: false, clipboardRequired: true });
    captured.clipboard = '<b>{{url}}</b>';
    expect(await fill('{{clipboard}}', captured)).toMatchObject({ ok: true, output: '<b>{{url}}</b>', clipboardRequired: false });
  });
  it('enforces precedence by name and first-appearance input order', async () => {
    const selected = prompt('review-github-pr');
    selected.body = '{{title}} {{project}} {{second}} {{focus}} {{second}}';
    selected.variables.push(...['title', 'project', 'second'].map(name => ({ kind: 'free',
      name, label: name, defaultValue: 'fallback', rememberLast: true } satisfies Prompt['variables'][number])));
    const snapshot = await prepareFill(selected, library(), context(), {}, execute);
    expect(snapshot.inputs.map(v => v.name)).toEqual(['second', 'focus']);
    expect(renderFill(snapshot)).toMatchObject({ ok: false, output: ' OPS fallback correctness fallback' });
    const unmatched = await prepareFill(selected, library(), context('https://github.com/a/b/pull/1'), {}, execute);
    expect(unmatched.inputs.map(v => v.name)).toEqual(['project', 'second', 'focus']);
  });
  it('uses defaults, explicit empty strings, and remembered values after successful copy (10)', async () => {
    const selected = prompt('review-github-pr');
    const initial = state();
    const first = await prepareFill(selected, initial.library, context('https://github.com/example/platform/pull/42'), {}, execute);
    expect(first.values.focus).toBe('correctness');
    expect(renderFill(first, { focus: '' })).toMatchObject({ ok: true });
    const copied = recordCopy(initial, first, { focus: 'error handling' }, '2026-09-17T12:01:00Z');
    const second = await prepareFill(selected, copied.library, first.context, copied.remembered[selected.id] ?? {}, execute);
    expect(renderFill(second).output).toBe('Review this pull request for error handling:\nhttps://github.com/example/platform/pull/42\nReport actionable findings with file and line references. Do not modify files.');
    expect(copied.usage[selected.id]).toEqual({ count: 1, lastUsedAt: '2026-09-17T12:01:00Z' });
    expect(initial.usage).toEqual({});
    expect(initial.remembered).toEqual({});
  });
  it('does not persist cancelled input, ignores disabled remembering, and prunes stale values (11)', async () => {
    const selected = prompt('review-github-pr');
    const initial = state();
    initial.remembered[selected.id] = { focus: 'saved' };
    const pending = await prepareFill(selected, initial.library, context(), initial.remembered[selected.id] ?? {}, execute);
    renderFill(pending, { focus: 'cancelled' });
    expect(initial.remembered[selected.id]).toEqual({ focus: 'saved' });
    selected.variables = selected.variables.map(v => ({ ...v, rememberLast: false }));
    expect(reconcileRemembered(selected, { focus: 'saved', deleted: 'old' })).toEqual({});
    expect((await prepareFill(selected, initial.library, context(), { focus: 'saved' }, execute)).values.focus).toBe('correctness');
  });
  it('collects free inputs through nested partials in first appearance order', async () => {
    const selected = prompt('review-github-pr'), lib = library();
    selected.body = '{{> outer}} {{focus}} {{second}}';
    selected.variables.push({ kind: 'free', name: 'second', label: 'Second', defaultValue: '', rememberLast: false });
    lib.partials.push({ name: 'outer', body: '{{second}} {{> inner}}' }, { name: 'inner', body: '{{focus}}' });
    const snapshot = await prepareFill(selected, lib, context('https://github.com/a/b/pull/1'), {}, execute);
    expect(snapshot.inputs.map(v => v.name)).toEqual(['second', 'focus']);
    expect(renderFill(snapshot, { second: 'two', focus: 'one' }).output).toBe('two one one two');
  });
  it('snapshots caller-owned inputs before waiting for rules', async () => {
    const selected = prompt('implement-ticket'), source = context(), lib = library();
    const pending = prepareFill(selected, lib, source, {}, execute);
    selected.body = 'changed'; source.source.url = 'https://wrong.example.com/'; lib.partials.length = 0;
    const snapshot = await pending;
    expect(renderFill(snapshot).output).toContain(exampleUrl);
    expect(Object.isFrozen(snapshot.context.source)).toBe(true);
    expect(Object.isFrozen(snapshot.prompt.variables)).toBe(true);
  });
  it('blocks a timed-out rule at fill time (29)', async () => {
    const lib = library();
    lib.siteRules = [{ id: 'bad', match: 'https://*/*', regex: '(a+)+$', flags: '' }];
    const snapshot = await prepareFill(prompt('implement-ticket'), lib, context('https://example.com/' + 'a'.repeat(100) + '!'), {}, execute);
    expect(renderFill(snapshot)).toMatchObject({ ok: false, ruleProblem: { code: 'timeout', ruleId: 'bad' } });
    const initial = state();
    expect(recordCopy(initial, snapshot, {}, '2026-09-17T00:00:00Z')).toBe(initial);
  });
});
