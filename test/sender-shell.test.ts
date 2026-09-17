import { describe, expect, it } from 'vitest';
import { trustedSender } from '../src/shell/messages.js';
import { createController } from '../src/shell/controller.js';
import { harness } from './shell-fixtures.js';

describe('Chrome-provided sender shapes', () => {
  const origin = 'chrome-extension://mise/';
  const cases = [
    { name: 'action popup without a tab', sender: { id: 'mise', url: origin + 'palette.html?popup' }, trusted: true },
    { name: 'palette window with a tab', sender: { id: 'mise', url: origin + 'palette.html', tab: { id: 7, windowId: 2 } }, trusted: true },
    { name: 'options document', sender: { id: 'mise', url: origin + 'options.html', tab: { id: 8 } }, trusted: true },
    { name: 'content script in an HTTP page', sender: { id: 'mise', url: 'http://example.com/', tab: { id: 1 } }, trusted: false },
    { name: 'wrong extension identity', sender: { id: 'other', url: origin + 'palette.html', tab: { id: 7 } }, trusted: false },
    { name: 'obsolete popup document', sender: { id: 'mise', url: origin + 'popup.html' }, trusted: false },
    { name: 'another extension origin', sender: { id: 'mise', url: 'chrome-extension://other/palette.html' }, trusted: false },
  ];
  it.each(cases)('$name', async ({ sender, trusted }) => {
    expect(trustedSender(sender, 'mise', origin)).toBe(trusted);
    const result = await createController(harness()).handle({ type: 'state' }, sender);
    if (trusted) expect(result).toMatchObject({ ok: true, data: { revision: 0 } });
    else expect(result).toEqual({ ok: false, error: 'Untrusted message sender' });
  });
  it('continues masking storage and platform error details', async () => {
    const deps = harness();
    deps.areas.local.get = async (): Promise<Record<string, unknown>> => { throw new Error('Storage failed with private data'); };
    const result = await createController(deps).handle({ type: 'state' }, cases[0]?.sender ?? {});
    expect(result).toEqual({ ok: false,
      error: 'Operation failed; storage or browser access is unavailable. No success was recorded.' });
  });
});
