import { describe, expect, it } from 'vitest';
import { createActivity, createSlot, readActivity, readSlot } from '../src/shell/slot.js';
import { listTabs, resolveSource } from '../src/shell/sources.js';
import { createWriteQueue } from '../src/shell/storage.js';
import { harness, MemoryArea } from './shell-fixtures.js';

describe('capture and source strategies', () => {
  it('replaces the slot, survives navigation, closure and suspension, but not restart', async () => {
    const deps = harness();
    const slot = createSlot(deps.session, deps.queue, deps.selection, deps.now);
    await slot.capture(await deps.tabs.get(1));
    deps.records.set(1, { id: 1, windowId: 1, url: 'https://ticket.example/b', incognito: false });
    expect((await slot.read())?.url).toBe('https://ticket.example/a');
    await slot.capture(await deps.tabs.get(1));
    deps.records.delete(1);
    const resumed = createSlot(deps.session, createWriteQueue(), deps.selection, deps.now);
    expect(await resumed.read()).toMatchObject({ url: 'https://ticket.example/b', selection: 'selected' });
    expect(await readSlot(new MemoryArea())).toBeNull();
    await resumed.clear();
    await expect(resolveSource(deps, 'capture', [])).rejects.toThrow('No captured source');
  });
  it('clears corrupt capture slots and offers the empty-slot recovery path', async () => {
    const deps = harness();
    const valid = await createSlot(deps.session, deps.queue, deps.selection, deps.now).capture(await deps.tabs.get(1));
    for (const corrupt of ['unparseable', {}, { ...valid, url: 'invalid' }, { ...valid, selection: 42 }]) {
      await deps.session.set({ slot: corrupt });
      expect(await readSlot(deps.session)).toBeNull();
      expect((await deps.session.get('slot')).slot).toBeNull();
      await expect(resolveSource(deps, 'capture', [])).rejects.toThrow('No captured source; capture a tab or choose a tab');
    }
  });
  it('caps activation history at the 50 most-recent distinct ids', async () => {
    const deps = harness();
    const activity = createActivity(deps.session, deps.permissions, deps.queue);
    for (let id = 1; id <= 75; id++) await activity.activated(id);
    expect(await readActivity(deps.session)).toEqual(Array.from({ length: 50 }, (_, index) => 75 - index));
    await activity.activated(50);
    expect(await readActivity(deps.session)).toEqual([50, ...Array.from({ length: 50 }, (_, index) => 75 - index).filter(id => id !== 50)]);
  });
  it('captures only a link target and rejects unsupported targets without replacement', async () => {
    const deps = harness();
    const slot = createSlot(deps.session, deps.queue, deps.selection, deps.now);
    await slot.capture(await deps.tabs.get(1));
    const value = await slot.link('https://target.example/path', 1);
    expect(value).toMatchObject({ url: 'https://target.example/path', source: 'link', title: null, selection: null });
    await expect(slot.link('javascript:alert(1)', 1)).rejects.toThrow('HTTP(S)');
    expect(await slot.read()).toEqual(value);
    expect(deps.selected).toEqual([1]);
  });
  it('keeps capture usable when selection is denied and preserves empty selection', async () => {
    const deps = harness();
    const blocked = createSlot(deps.session, deps.queue, { read: async (): Promise<never> => { throw new Error('restricted'); } }, deps.now);
    expect((await blocked.capture(await deps.tabs.get(1))).selection).toBeNull();
    const empty = createSlot(deps.session, deps.queue, { read: async (): Promise<string> => '' }, deps.now);
    expect((await empty.capture(await deps.tabs.get(1))).selection).toBe('');
  });
  it('orders observed activations across suspension and excludes all ineligible tabs', async () => {
    const deps = harness();
    const activity = createActivity(deps.session, deps.permissions, deps.queue);
    const excluded = ['https://chat.example/a', 'chrome-extension://mise/options.html', 'file:///tmp/test', 'https://private.example/', 'https://popup.example/'];
    await activity.activated(1);
    for (const [index, url] of excluded.entries()) {
      const id = index + 2;
      deps.records.set(id, { id, url, windowId: id === 6 ? 2 : 1, incognito: id === 5 });
      await activity.activated(id);
    }
    expect((await resolveSource(deps, 'last-non-chat', ['chat.example'])).sourceTabId).toBe(1);
    deps.records.set(1, { id: 1, windowId: 1, incognito: false, url: 'https://updated.example/', title: 'Updated' });
    expect(await resolveSource(deps, 'last-non-chat', ['chat.example'])).toMatchObject({ title: 'Updated', url: 'https://updated.example/', selection: null });
    await activity.removed(1);
    expect(await readActivity(deps.session)).not.toContain(1);
    await expect(resolveSource(deps, 'last-non-chat', ['chat.example'])).rejects.toThrow('No eligible');
    await expect(resolveSource({ ...deps, session: new MemoryArea() }, 'last-non-chat', ['chat.example'])).rejects.toThrow('No eligible');
  });
  it('requires configuration and permission, including revocation, without fallback', async () => {
    const deps = harness();
    await expect(resolveSource(deps, 'last-non-chat', [])).rejects.toThrow('Configure');
    const slot = createSlot(deps.session, deps.queue, deps.selection, deps.now);
    await slot.capture(await deps.tabs.get(1));
    deps.allowed = false;
    await expect(resolveSource(deps, 'last-non-chat', ['chat.example'])).rejects.toThrow('absent or revoked');
    await expect(listTabs(deps, '')).rejects.toThrow('absent or revoked');
    await expect(resolveSource(deps, 'tab-picker', [], 1)).rejects.toThrow('absent or revoked');
    expect((await resolveSource(deps, 'capture', [])).sourceTabId).toBe(1);
    const activity = createActivity(deps.session, deps.permissions, deps.queue);
    await activity.activated(1);
    expect(await readActivity(deps.session)).toEqual([]);
  });
  it('picker filters text and overrides a fill without touching the capture slot', async () => {
    const deps = harness();
    const slot = createSlot(deps.session, deps.queue, deps.selection, deps.now);
    const staged = await slot.link('https://staged.example/', null);
    expect(await listTabs(deps, 'ticket a')).toHaveLength(1);
    expect(await listTabs(deps, 'missing')).toEqual([]);
    expect(await resolveSource(deps, 'capture', [], 1)).toMatchObject({ title: 'Ticket A', selection: null });
    expect(await slot.read()).toEqual(staged);
    expect(deps.selected).toEqual([]);
  });
  it('rechecks permission after reading metadata and clears activation order on revocation', async () => {
    const deps = harness();
    const activity = createActivity(deps.session, deps.permissions, deps.queue);
    await activity.activated(1);
    const get = deps.tabs.get;
    deps.tabs.get = async (id) => { const tab = await get(id); deps.allowed = false; return tab; };
    await expect(resolveSource(deps, 'last-non-chat', ['chat.example'])).rejects.toThrow('absent or revoked');
    await activity.reset();
    expect(await readActivity(deps.session)).toEqual([]);
  });

});
