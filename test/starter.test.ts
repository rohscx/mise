import { describe, expect, it, vi } from 'vitest';
import { validateLibrary } from '../src/core/library.js';
import { starterLibrary } from '../src/shared/starter.js';
import { createController } from '../src/shell/controller.js';
import type { Controller } from '../src/shell/controller.js';
import { createEvents } from '../src/shell/events.js';
import type { EventHandlers } from '../src/shell/events.js';
import { emptyState, readState, writeState } from '../src/shell/storage.js';
import { harness, sender } from './shell-fixtures.js';
import type { Harness } from './shell-fixtures.js';

function installation(): { deps: Harness; controller: Controller; events: EventHandlers; menu: () => Promise<void> } {
  const deps = harness();
  const controller = createController(deps);
  const menu = vi.fn(async (): Promise<void> => undefined);
  const events = createEvents(controller, deps.session, deps.queue, {
    menu, badge: async (): Promise<void> => undefined, openPalette: async (): Promise<void> => undefined,
  }, deps.now);
  return { deps, controller, events, menu };
}

describe('starter library installation', () => {
  it('passes complete library validation', () => {
    expect(validateLibrary(starterLibrary)).toEqual({ ok: true, value: starterLibrary });
  });
  it('seeds a fresh install and rejects an editor holding the old revision', async () => {
    const { deps, controller, events, menu } = installation();
    const notify = vi.spyOn(deps, 'notify');
    await events.installed('install');
    expect(await readState(deps.areas.local)).toMatchObject({ revision: 1, generation: 1, state: { library: starterLibrary } });
    expect(deps.areas.local.writes).toBe(1);
    expect(notify).toHaveBeenCalledWith({ type: 'library-replaced', generation: 1 });
    expect(menu).toHaveBeenCalledOnce();
    expect(await controller.handle({ type: 'save', revision: 0, library: emptyState().state.library }, sender))
      .toMatchObject({ ok: false, error: expect.stringContaining('Stale') });
  });
  it.each(['prompts', 'partials', 'siteRules'] as const)('preserves a library containing only %s', async field => {
    const { deps, events } = installation();
    const stored = emptyState();
    Object.assign(stored.state.library, { [field]: starterLibrary[field] });
    await writeState(deps.areas.local, stored);
    await events.installed('install');
    expect(await readState(deps.areas.local)).toEqual(stored);
    expect(deps.areas.local.writes).toBe(1);
  });
  it.each(['update', 'chrome_update', 'shared_module_update'])('does not seed for %s', async reason => {
    const { deps, events, menu } = installation();
    await events.installed(reason);
    expect(deps.areas.local.writes).toBe(0);
    expect(menu).toHaveBeenCalledOnce();
  });
  it('leaves a deliberately emptied library empty on update and controller restart', async () => {
    const { deps, controller, events } = installation();
    await events.installed('install');
    expect((await controller.handle({ type: 'save', revision: 1, library: emptyState().state.library }, sender)).ok).toBe(true);
    await events.installed('update');
    await createController(deps).handle({ type: 'state' }, sender);
    expect((await readState(deps.areas.local)).state.library).toEqual(emptyState().state.library);
    expect(deps.areas.local.writes).toBe(2);
  });
  it('checks emptiness after earlier queued writes finish', async () => {
    const { deps, events } = installation();
    const stored = emptyState();
    stored.state.library.partials = [{ name: 'existing', body: 'Keep me' }];
    const write = deps.queue(async () => { await writeState(deps.areas.local, stored); });
    await Promise.all([write, events.installed('install')]);
    expect(await readState(deps.areas.local)).toEqual(stored);
    expect(deps.areas.local.writes).toBe(1);
  });
  it('rejects invalid starter content without writing', async () => {
    const { deps, events } = installation();
    const partials = starterLibrary.partials;
    try {
      starterLibrary.partials = [];
      await expect(events.installed('install')).rejects.toThrow('Invalid library');
      expect(deps.areas.local.writes).toBe(0);
    } finally { starterLibrary.partials = partials; }
  });
});
