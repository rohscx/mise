import { afterEach, describe, expect, it, vi } from 'vitest';
import { harness } from './shell-fixtures.js';
import { restrictStorage } from '../src/shell/storage.js';
import type { Response } from '../src/shared/messages.js';
import type { Sender } from '../src/shell/messages.js';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

describe('worker startup across storage API versions', () => {
  it.each([false, true])('serves messages with session-only restriction support, failure=%s', async fail => {
    const deps = harness();
    expect('setAccessLevel' in deps.areas.local).toBe(false);
    expect('setAccessLevel' in deps.areas.sync).toBe(false);
    if (fail) vi.spyOn(deps.areas.session, 'setAccessLevel').mockRejectedValue(new Error('denied'));
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const badge = vi.fn(async (): Promise<void> => undefined);
    const event = { addListener: vi.fn() };
    let handle: ((message: unknown, sender: Sender, respond: (response: Response) => void) => boolean) | undefined;
    vi.stubGlobal('chrome', {
      storage: { ...deps.areas, onChanged: event },
      runtime: { id: deps.extensionId, getURL: (path: string): string => deps.origin + path,
        onMessage: { addListener: (listener: typeof handle): void => { handle = listener; } }, onInstalled: event },
      tabs: { ...deps.tabs, onActivated: event, onRemoved: event }, windows: deps.windows,
      permissions: { ...deps.permissions, onRemoved: event },
      action: { setBadgeText: badge }, commands: { onCommand: event },
      contextMenus: { onClicked: event }, omnibox: { onInputChanged: event, onInputEntered: event },
    });
    await import('../src/sw.js');
    const listener = handle;
    if (!listener) throw new Error('Worker did not register its message handler');
    const response = await new Promise<Response>(resolve => {
      listener({ type: 'state' }, { id: deps.extensionId, url: deps.origin + 'palette.html' }, resolve);
    });
    expect(response).toMatchObject({ ok: true, data: { revision: 0 } });
    if (fail) {
      expect(diagnostic).toHaveBeenCalledWith('Storage access restriction failed. Reload the extension to retry.');
      expect(badge).toHaveBeenCalledWith({ text: '!' });
    } else {
      expect(deps.areas.session.access).toBe('TRUSTED_CONTEXTS');
      expect(diagnostic).not.toHaveBeenCalled();
    }
  });
  it('also restricts local storage when that API is available', async () => {
    const deps = harness();
    const local = Object.assign(deps.areas.local, {
      setAccessLevel: vi.fn(async (): Promise<void> => undefined),
    });
    await restrictStorage({ ...deps.areas, local });
    expect(local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    expect(deps.areas.session.access).toBe('TRUSTED_CONTEXTS');
  });
});
