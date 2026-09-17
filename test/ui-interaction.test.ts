import { describe, expect, it } from 'vitest';
import { canClearCapture, copyFill, searchSelection, sourceText } from '../src/ui/interaction.js';
import { buildSearchIndex, rankPrompts } from '../src/core/ranking.js';
import { context, library } from './fixtures.js';

describe('fill interactions', () => {
  it('enables Clear capture only while a source is staged', () => {
    expect(canClearCapture(null)).toBe(false);
    expect(canClearCapture(context().source)).toBe(true);
    expect(canClearCapture({ ...context().source, source: 'link' })).toBe(true);
  });
  it('writes clipboard, announces success, then writes usage and remembered values', async () => {
    const events: string[] = [];
    await copyFill('plain text', {
      write: async text => { events.push(`clipboard:${text}`); },
      announce: message => { events.push(message); },
      remember: async () => { events.push('usage + remembered'); },
    });
    expect(events).toEqual(['clipboard:plain text', 'Copied. Paste into your chat.', 'usage + remembered']);
  });
  it('does not announce success or write bookkeeping when clipboard fails', async () => {
    const events: string[] = [];
    await copyFill('text', {
      write: async () => { events.push('clipboard'); throw new Error('denied'); },
      announce: message => { events.push(message); }, remember: async () => { events.push('remember'); },
    });
    expect(events).toEqual(['clipboard', 'Copy failed']);
  });
  it('reports bookkeeping failure separately and never retries the clipboard', async () => {
    const events: string[] = [];
    await copyFill('text', {
      write: async () => { events.push('clipboard'); }, announce: message => { events.push(message); },
      remember: async () => { events.push('remember'); throw new Error('quota'); },
    });
    expect(events).toEqual(['clipboard', 'Copied. Paste into your chat.', 'remember',
      'Copied. Paste into your chat. Usage and remembered values were not saved.']);
  });
  it('waits for clipboard completion before announcing or saving', async () => {
    const events: string[] = [];
    let finish: () => void = () => undefined;
    const pending = copyFill('text', { write: () => new Promise<void>(resolve => { finish = resolve; }),
      announce: message => { events.push(message); }, remember: async () => { events.push('saved'); } });
    expect(events).toEqual([]); finish(); await pending;
    expect(events).toEqual(['Copied. Paste into your chat.', 'saved']);
  });
  it('bounds keyboard selection and keeps Enter as selection only', () => {
    expect(searchSelection(0, 'ArrowDown', 3)).toBe(1);
    expect(searchSelection(0, 'ArrowUp', 3)).toBe(0);
    expect(searchSelection(2, 'ArrowDown', 3)).toBe(2);
    expect(searchSelection(1, 'Enter', 3)).toBe(1);
    expect(searchSelection(0, 'Enter', 0)).toBe(-1);
  });
  it('selects a fuzzy partial-text match and a tag match through the shared ranking', () => {
    const lib = library(); const first = lib.prompts[0];
    if (!first) throw new Error('Fixture missing');
    first.body = '{{> unique}}'; first.tags = ['findtag'];
    lib.partials.push({ name: 'unique', body: 'xylophone quantum zebra' });
    const index = buildSearchIndex(lib);
    for (const query of ['xqz', 'findtag']) {
      const matches = rankPrompts(index, query, null);
      expect(matches[searchSelection(0, 'Enter', matches.length)]?.prompt.id).toBe(first.id);
    }
  });
  it.each(['capture', 'last-non-chat', 'tab-picker'] as const)('shows full source and age for %s', strategy => {
    const source = context('https://example.com/a?secret=full#fragment').source;
    expect(sourceText(source, strategy, Date.parse(source.capturedAt) + 120000))
      .toBe(`https://example.com/a?secret=full#fragment\n${strategy} · tab · 2m ago`);
  });
});
