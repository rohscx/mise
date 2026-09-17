import type { CaptureSlot, ContextStrategy } from '../shared/types.js';
import type { StorageArea } from './storage.js';
import type { BrowserTab, PermissionAccess, TabAccess } from './slot.js';
import { httpUrl, readActivity, readSlot, snapshot } from './slot.js';

export interface WindowAccess {
  get(id: number): Promise<{ type?: string | undefined; incognito: boolean }>;
  getLastFocused(options: { populate: boolean; windowTypes: ['normal'] }): Promise<{ tabs?: BrowserTab[] | undefined }>;
}
export interface Sources { session: StorageArea; tabs: TabAccess; windows: WindowAccess; permissions: PermissionAccess; now: () => string }
export async function requireTabs(permissions: PermissionAccess): Promise<void> {
  if (!await permissions.contains({ permissions: ['tabs'] })) throw new Error('Tabs permission is absent or revoked; enable it to choose another tab');
}
export async function requireStrategy(strategy: ContextStrategy, hosts: string[], permissions: PermissionAccess): Promise<void> {
  if (strategy === 'capture') return;
  await requireTabs(permissions);
  if (strategy === 'last-non-chat' && !hosts.length) throw new Error('Configure known chat hosts before enabling last-non-chat');
}
async function eligible(deps: Sources, tab: BrowserTab, hosts: string[]): Promise<boolean> {
  const url = httpUrl(tab.url);
  if (!url || tab.incognito || hosts.includes(new URL(url).hostname)) return false;
  const window = await deps.windows.get(tab.windowId);
  return window.type === 'normal' && !window.incognito;
}
export async function listTabs(deps: Sources, query: string): Promise<CaptureSlot[]> {
  await requireTabs(deps.permissions);
  const result: CaptureSlot[] = [];
  for (const tab of await deps.tabs.query({ windowType: 'normal' })) {
    if (await eligible(deps, tab, []) && `${tab.title ?? ''} ${tab.url ?? ''}`.toLowerCase().includes(query.toLowerCase())) {
      result.push(snapshot(tab, deps.now()));
    }
  }
  // Permission may have been revoked during the asynchronous metadata reads.
  await requireTabs(deps.permissions);
  return result;
}
export async function resolveSource(deps: Sources, strategy: ContextStrategy, hosts: string[], pickedTabId?: number): Promise<CaptureSlot> {
  if (pickedTabId !== undefined) {
    await requireTabs(deps.permissions);
    const tab = await deps.tabs.get(pickedTabId);
    if (!await eligible(deps, tab, [])) throw new Error('Selected tab is no longer eligible');
    // Permission may have been revoked during the asynchronous metadata reads.
    await requireTabs(deps.permissions);
    return snapshot(tab, deps.now());
  }
  if (strategy === 'capture') {
    const slot = await readSlot(deps.session);
    if (!slot) throw new Error('No captured source; capture a tab or choose a tab');
    return slot;
  }
  await requireStrategy(strategy, hosts, deps.permissions);
  if (strategy === 'tab-picker') throw new Error('Choose a source tab');
  for (const id of await readActivity(deps.session)) {
    let tab: BrowserTab;
    try { tab = await deps.tabs.get(id); } catch { continue; }
    if (await eligible(deps, tab, hosts)) {
      // Permission may have been revoked during the asynchronous metadata reads.
      await requireTabs(deps.permissions);
      return snapshot(tab, deps.now());
    }
  }
  // Distinguish permission revoked during the search from a lack of eligible tabs.
  await requireTabs(deps.permissions);
  throw new Error('No eligible observed activation; activate a source tab or choose a tab');
}
