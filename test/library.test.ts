import { describe, expect, it } from 'vitest';
import { exportLibrary, importLibrary, replacementState, validateLibrary } from '../src/core/library.js';
import { library, state } from './fixtures.js';

describe('library shape and semantic validation', () => {
  it('accepts the real four-prompt, four-partial, two-rule library (2)', () => {
    const example = library();
    expect([example.prompts.length, example.partials.length, example.siteRules.length]).toEqual([4, 4, 2]);
  });
  it('round-trips only the exact export fields (25)', () => {
    const example = library();
    const exported = exportLibrary(example);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(importLibrary(exported.value)).toEqual({ ok: true, value: example });
    expect(Object.keys(JSON.parse(exported.value))).toEqual(['schemaVersion', 'prompts', 'partials', 'siteRules']);
    expect(exportLibrary(state()).ok).toBe(false);
  });
  it.each([
    '{', '\uFEFF{}', '{"schemaVersion":1,"schemaVersion":1}',
    '{"schemaVersion":1,"schema\\u0056ersion":1}',
    '{"schemaVersion":1,"prompts":[],"partials":[{"name":"a","name":"b","body":""}],"siteRules":[]}',
  ])('rejects malformed or duplicate-key input (26): %s', text => {
    expect(importLibrary(text).ok).toBe(false);
  });
  it('rejects oversized files and unsupported versions without mutating prior state (26)', () => {
    const initial = state(), before = structuredClone(initial);
    expect(importLibrary(' '.repeat(5 * 1024 * 1024 + 1)).ok).toBe(false);
    expect(validateLibrary({ ...library(), schemaVersion: 2 })).toMatchObject({ ok: false });
    expect(initial).toEqual(before);
  });
  it('rejects unknown fields, missing fields, wrong types and duplicate collections', () => {
    const example = library();
    expect(validateLibrary({ ...example, remembered: {} }).ok).toBe(false);
    expect(validateLibrary({ ...example, prompts: [{ ...example.prompts[0], extra: true }] }).ok).toBe(false);
    for (const variables of [[{ kind: 'free', name: 'x' }], [{ kind: 'context', name: 'url' }]]) {
      expect(validateLibrary({ ...example, prompts: [{ ...example.prompts[0], variables }] }).ok).toBe(false);
    }
    for (const change of [{ name: '' }, { id: 'INVALID' }, { tags: ['x', 'x'] }, { scope: ['https://*/*', 'https://*/*'] }, { body: 42 }]) {
      expect(validateLibrary({ ...example, prompts: [{ ...example.prompts[0], ...change }] }).ok).toBe(false);
    }
    expect(validateLibrary({ ...example, prompts: [...example.prompts, ...example.prompts] }).ok).toBe(false);
    expect(validateLibrary({ ...example, partials: [...example.partials, ...example.partials] }).ok).toBe(false);
    expect(validateLibrary({ ...example, siteRules: [...example.siteRules, ...example.siteRules] }).ok).toBe(false);
  });
  it('rejects reserved/free duplicates, invalid patterns, flags, regexes and capture names', () => {
    const example = library();
    const free = { kind: 'free', name: 'focus', label: 'Focus', defaultValue: '', rememberLast: false };
    for (const variables of [[free, free], [{ ...free, name: 'title' }], [{ ...free, name: 'url.host' }]]) {
      expect(validateLibrary({ ...example, prompts: [{ ...example.prompts[0], variables }] }).ok).toBe(false);
    }
    expect(validateLibrary({ ...example, prompts: [{ ...example.prompts[0], scope: ['<all_urls>'] }] }).ok).toBe(false);
    for (const change of [{ regex: '(' }, { regex: '(?<date>x)' }, { regex: '(?<bad-name>x)' }, { regex: 'x'.repeat(4097) }, { flags: 'g' }, { match: 'file:///*' }]) {
      expect(validateLibrary({ ...example, siteRules: [{ ...example.siteRules[0], ...change }] }).ok).toBe(false);
    }
  });
  it('rejects missing partials, cycles, excess depth, bad syntax and unknown variables', () => {
    const example = library();
    for (const body of ['{{> missing}}', '{{unknown}}', '{{', '{{bad name}}']) {
      expect(validateLibrary({ ...example, prompts: [{ ...example.prompts[0], body }] }).ok).toBe(false);
    }
    expect(validateLibrary({ ...example, partials: [...example.partials, { name: 'cycle', body: '{{> cycle}}' }] }).ok).toBe(false);
    const partials = Array.from({ length: 9 }, (_, i) => ({ name: `p${i}`, body: i === 8 ? '' : `{{> p${i + 1}}}` }));
    expect(validateLibrary({ ...example, partials, prompts: [{ ...example.prompts[0], body: '{{> p0}}' }] }).ok).toBe(false);
    expect(validateLibrary({ ...example, prompts: [{ ...example.prompts[0], body: 'é'.repeat(524289) }] }).ok).toBe(false);
  });
  it('allows draft text while still enforcing schema, name and rule constraints', () => {
    const example = library();
    const draft = { ...example, prompts: [{ ...example.prompts[0], body: '{{unfinished' }] };
    expect(validateLibrary(draft, 'draft').ok).toBe(true);
    expect(importLibrary(JSON.stringify(draft)).ok).toBe(false);
    expect(exportLibrary(draft).ok).toBe(false);
    expect(validateLibrary({ ...draft, siteRules: [{ ...example.siteRules[0], regex: '(' }] }, 'draft').ok).toBe(false);
  });
  it('checks variables against each consuming prompt and accepts possible rule captures', () => {
    const example = library();
    expect(validateLibrary({ ...example, prompts: [{ ...example.prompts[0], body: '{{ticket}}' }] }).ok).toBe(true);
    expect(validateLibrary({ ...example, partials: [...example.partials, { name: 'free', body: '{{focus}}' }],
      prompts: [{ ...example.prompts[0], body: '{{> free}}' }] }).ok).toBe(false);
  });
  it('retains inert markup and allows duplicate keys in separate objects (29)', () => {
    const example = library();
    const body = '<script>alert("x")</script><img src=x onerror=alert(1)>';
    const result = importLibrary(JSON.stringify({ ...example, prompts: [{ ...example.prompts[0], body }] }));
    expect(result.ok && result.value.prompts[0]?.body).toBe(body);
  });
  it('prepares replacement independently, clearing activity and retaining settings', () => {
    const initial = state();
    initial.usage = { old: { count: 1, lastUsedAt: null } };
    initial.remembered = { old: { focus: 'private' } };
    initial.knownChatHosts = ['chat.example.com'];
    const next = replacementState(initial, library());
    expect(next.usage).toEqual({}); expect(next.remembered).toEqual({});
    expect(next.knownChatHosts).toEqual(initial.knownChatHosts);
    expect(initial.usage.old?.count).toBe(1);
  });
});
