import { describe, expect, it } from 'vitest';
import { createController } from '../src/shell/controller.js';
import { createWriteQueue, emptyState, readState, restrictStorage, writeState } from '../src/shell/storage.js';
import { harness, sender } from './shell-fixtures.js';
import { library } from './fixtures.js';

describe('worker storage and protocol', () => {
  it('serializes read-modify-write operations and recovers after failure', async () => {
    const queue = createWriteQueue();
    const order: number[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = queue(async () => { order.push(1); await gate; order.push(2); });
    const second = queue(async () => { order.push(3); });
    await Promise.resolve(); expect(order).toEqual([1]); release();
    await Promise.all([first, second]); expect(order).toEqual([1, 2, 3]);
    await expect(queue(async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    expect(await queue(async () => 4)).toBe(4);
  });
  it('rejects one of two concurrent editor saves and rehydrates after suspension', async () => {
    const deps = harness(); const controller = createController(deps);
    const results = await Promise.all([controller.handle({ type: 'save', revision: 0, library: library() }, sender),
      controller.handle({ type: 'save', revision: 0, library: library() }, sender)]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(results.find(r => !r.ok)).toMatchObject({ error: expect.stringContaining('Stale') });
    expect((await readState(deps.areas.local)).revision).toBe(1);
    expect(await createController({ ...deps, queue: createWriteQueue() }).handle({ type: 'state' }, sender))
      .toMatchObject({ ok: true, data: { revision: 1 } });
  });
  it('leaves the whole state untouched after invalid import or quota failure', async () => {
    const deps = harness(); const controller = createController(deps);
    await controller.handle({ type: 'save', revision: 0, library: library() }, sender);
    const before = await readState(deps.areas.local);
    expect((await controller.handle({ type: 'import', revision: 1, text: '{"schemaVersion":9}' }, sender)).ok).toBe(false);
    deps.areas.local.fail = true;
    expect((await controller.handle({ type: 'import', revision: 1, text: JSON.stringify(library()) }, sender)).ok).toBe(false);
    expect(await readState(deps.areas.local)).toEqual(before);
  });
  it('protects sender and request shape, including prototype names', async () => {
    const controller = createController(harness());
    for (const untrusted of [{}, { id: 'mise', url: 'https://example.com' }, { ...sender, tab: { id: 1 }, url: 'https://example.com/' }, { ...sender, id: 'other' }]) {
      expect((await controller.handle({ type: 'state' }, untrusted)).ok).toBe(false);
    }
    for (const request of [{ type: '__proto__' }, { type: 'state', extra: true }, { type: 'fill', promptId: 12 }, { type: 'save', revision: -1, library: library() }]) {
      expect((await controller.handle(request, sender)).ok).toBe(false);
    }
  });
  it('round-trips __proto__ free values safely and removes them when remembering is disabled', async () => {
    const deps = harness(); const controller = createController(deps); const input = library();
    const prompt = input.prompts[0]; if (!prompt) throw new Error('fixture');
    prompt.variables = [{ kind: 'free', name: '__proto__', label: 'Value', defaultValue: '', rememberLast: true }];
    prompt.body = '{{__proto__}}';
    await controller.handle({ type: 'save', revision: 0, library: input }, sender);
    const copied = await controller.handle({ type: 'copied', revision: 1, generation: 0, promptId: prompt.id,
      values: JSON.parse('{"__proto__":"kept"}') as unknown }, sender);
    expect(copied.ok).toBe(true);
    let stored = await readState(deps.areas.local);
    expect(Object.getPrototypeOf(stored.state.remembered[prompt.id])).toBeNull();
    expect(stored.state.remembered[prompt.id]?.['__proto__']).toBe('kept');
    const variable = prompt.variables[0]; if (!variable) throw new Error('fixture'); variable.rememberLast = false;
    await controller.handle({ type: 'save', revision: 1, library: input }, sender);
    stored = await readState(deps.areas.local);
    expect(Object.hasOwn(stored.state.remembered[prompt.id] ?? {}, '__proto__')).toBe(false);
  });
  it('replacement clears activity values and invalidates fills while keeping settings and slot', async () => {
    const deps = harness(); const stored = emptyState(); stored.state.library = library();
    stored.state.usage.test = { count: 2, lastUsedAt: null }; stored.state.remembered.test = { value: 'old' };
    stored.state.knownChatHosts = ['chat.example']; await writeState(deps.areas.local, stored);
    await deps.session.set({ slot: 'sentinel' });
    const controller = createController(deps);
    expect((await controller.handle({ type: 'import', revision: 0, text: JSON.stringify(library()) }, sender)).ok).toBe(true);
    expect(await readState(deps.areas.local)).toMatchObject({ generation: 1, state: { usage: {}, remembered: {}, knownChatHosts: ['chat.example'] } });
    expect((await deps.session.get('slot')).slot).toBe('sentinel');
  });
  it('keeps sync opt-in and limited to strategy, tolerates failure, and respects local prerequisites', async () => {
    const deps = harness(); const controller = createController(deps);
    await deps.areas.sync.set({ strategy: 'tab-picker' });
    await controller.receiveSync(); expect((await readState(deps.areas.local)).state.strategy).toBe('capture');
    expect((await controller.handle({ type: 'settings', revision: 0, strategy: 'capture', knownChatHosts: ['chat.example'], syncEnabled: true }, sender)).ok).toBe(true);
    expect(deps.areas.sync.data).toEqual({ strategy: 'capture' });
    await deps.areas.sync.set({ strategy: 'last-non-chat' }); deps.allowed = false;
    await controller.receiveSync(); expect((await readState(deps.areas.local)).state.strategy).toBe('capture');
    deps.allowed = true; await controller.receiveSync(); expect((await readState(deps.areas.local)).state.strategy).toBe('last-non-chat');
    deps.areas.sync.fail = true;
    expect(await controller.handle({ type: 'settings', revision: 2, strategy: 'capture', knownChatHosts: [], syncEnabled: true }, sender))
      .toMatchObject({ ok: true, data: { syncPublished: false } });
    await restrictStorage(deps.areas);
    expect(deps.areas.session.access).toBe('TRUSTED_CONTEXTS');
    expect('setAccessLevel' in deps.areas.local).toBe(false);
    expect('setAccessLevel' in deps.areas.sync).toBe(false);
  });
});
