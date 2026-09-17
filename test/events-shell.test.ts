import { describe, expect, it } from 'vitest';
import { createController } from '../src/shell/controller.js';
import { createEvents } from '../src/shell/events.js';
import { openPalette } from '../src/shell/palette.js';
import type { Invocation } from '../src/shell/palette.js';
import { readState } from '../src/shell/storage.js';
import { harness, sender } from './shell-fixtures.js';
import { library } from './fixtures.js';

describe('browser events and fill handoff', () => {
  it('omnibox descriptions contain escaped names only and routes unmatched queries', async () => {
    const deps = harness(); const controller = createController(deps); const input = library();
    const first = input.prompts[0]; if (!first) throw new Error('fixture'); first.name = '<ticket&>';
    await controller.handle({ type: 'save', revision: 0, library: input }, sender);
    const opened: Invocation[] = []; const badges: string[] = [];
    const events = createEvents(controller, deps.session, deps.queue, {
      openPalette: async (route): Promise<void> => { opened.push(route); },
      badge: async (value): Promise<void> => { badges.push(value); }, menu: async (): Promise<void> => undefined,
    }, deps.now);
    const suggestions = await events.suggestions('<ticket&>');
    expect(suggestions).toEqual([{ content: `prompt:${first.id}`, description: '&lt;ticket&amp;&gt;' }]);
    await events.entered(`prompt:${first.id}`); await events.entered('unmatched query'); await events.command('open-palette');
    expect(opened).toEqual([{ promptId: first.id }, { query: 'unmatched query' }, {}]);
    await events.link('https://target.example/', await deps.tabs.get(1)); expect(badges).toEqual(['OK']);
    expect(await controller.handle({ type: 'slot' }, sender)).toMatchObject({ data: { title: null, selection: null, source: 'link' } });
  });
  it('opens or focuses a palette and persists the latest invocation', async () => {
    const deps = harness(); const actions: string[] = [];
    let exists = false;
    const windows = {
      getAll: async (): Promise<{ id: number; tabs: { url: string }[] }[]> => exists ? [{ id: 9, tabs: [{ url: 'extension/palette.html' }] }] : [],
      update: async (): Promise<void> => { actions.push('focus'); },
      create: async (): Promise<void> => { actions.push('create'); exists = true; },
    };
    await openPalette(windows, deps.session, deps.queue, 'extension/palette.html', { query: 'one' });
    await openPalette(windows, deps.session, deps.queue, 'extension/palette.html', { query: 'two' });
    expect(actions).toEqual(['create', 'focus']);
    expect(await createController(deps).handle({ type: 'invocation' }, sender)).toEqual({ ok: true, data: { query: 'two' } });
  });
  it('hands off a frozen source with transient clipboard and permits repeated successful copy acknowledgements', async () => {
    const deps = harness(); const controller = createController(deps); const input = library();
    const first = input.prompts[0]; if (!first) throw new Error('fixture');
    await controller.handle({ type: 'save', revision: 0, library: input }, sender);
    await controller.handle({ type: 'capture' }, sender);
    const fill = await controller.handle({ type: 'fill', promptId: first.id }, sender);
    expect(fill).toMatchObject({ ok: true, data: { context: { clipboard: null, source: { url: 'https://ticket.example/a' } } } });
    const ack = { type: 'copied', revision: 1, generation: 0, promptId: first.id, values: {} };
    expect((await controller.handle(ack, sender)).ok).toBe(true);
    expect((await controller.handle(ack, sender)).ok).toBe(true);
    expect((await readState(deps.areas.local)).state.usage[first.id]?.count).toBe(2);
    deps.areas.local.fail = true;
    expect(await controller.handle(ack, sender)).toMatchObject({ ok: false, error: expect.stringContaining('Clipboard delivery succeeded') });
    expect((await readState(deps.areas.local)).state.usage[first.id]?.count).toBe(2);
  });
  it('blocks referenced partial deletion, allows draft syntax, and clears deleted prompt metadata', async () => {
    const deps = harness(); const controller = createController(deps); const input = library();
    await controller.handle({ type: 'save', revision: 0, library: input }, sender);
    const removed = structuredClone(input); removed.partials = [];
    expect(await controller.handle({ type: 'save', revision: 1, library: removed }, sender))
      .toMatchObject({ ok: false, error: expect.stringContaining('references') });
    const first = input.prompts[0]; if (!first) throw new Error('fixture'); first.body = '{{unfinished';
    expect((await controller.handle({ type: 'save', revision: 1, library: input }, sender)).ok).toBe(true);
    expect((await controller.handle({ type: 'export' }, sender)).ok).toBe(false);
    await controller.handle({ type: 'copied', revision: 2, generation: 0, promptId: first.id, values: {} }, sender);
    input.prompts = input.prompts.filter(prompt => prompt.id !== first.id);
    expect((await controller.handle({ type: 'save', revision: 2, library: input }, sender)).ok).toBe(true);
    expect((await readState(deps.areas.local)).state.usage[first.id]).toBeUndefined();
  });
});
