import type { CaptureSlot } from '../shared/types.js';
import type { StorageArea, WriteQueue } from './storage.js';
import { safeClone } from './storage.js';
import { isRecord } from '../core/schema.js';

export interface BrowserTab { active?: boolean | undefined; id?: number | undefined; windowId: number; url?: string | undefined; title?: string | undefined; incognito: boolean }
export interface TabAccess {
  get(id: number): Promise<BrowserTab>;
  query(query: { active?: boolean; lastFocusedWindow?: boolean; windowType?: 'normal' }): Promise<BrowserTab[]>;
}
export interface PermissionAccess { contains(permissions: { permissions: string[] }): Promise<boolean> }
export interface SelectionAccess { read(tabId: number): Promise<string | null> }
export function httpUrl(input: string | undefined): string | null {
  try { const url = new URL(input ?? ''); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}
export async function readSlot(session: StorageArea): Promise<CaptureSlot | null> {
  const value = (await session.get('slot')).slot;
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || typeof value.url !== 'string' || !httpUrl(value.url)
    || !(value.title === null || typeof value.title === 'string')
    || !(value.selection === null || typeof value.selection === 'string')
    || !(value.sourceTabId === null || Number.isInteger(value.sourceTabId))
    || !['tab', 'link'].includes(String(value.source)) || typeof value.capturedAt !== 'string') {
    await session.set({ slot: null });
    return null;
  }
  return safeClone(value) as unknown as CaptureSlot;
}
export function snapshot(tab: BrowserTab, at: string): CaptureSlot {
  const url = httpUrl(tab.url);
  if (!url || tab.incognito) throw new Error('Capture requires a normal HTTP(S) tab');
  return { url, title: tab.title ?? null, selection: null, sourceTabId: tab.id ?? null, source: 'tab', capturedAt: at };
}
// URL and title come from the tab; only the selection needs the page. A page
// still parsing, or busy in a long task, cannot run the injected read until it
// yields, so the read is capped and capture proceeds without a selection.
export const SELECTION_TIMEOUT_MS = 750;
async function readSelection(selection: SelectionAccess, tabId: number): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      selection.read(tabId).catch((): null => null),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), SELECTION_TIMEOUT_MS); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
export interface Slot {
  read(): Promise<CaptureSlot | null>;
  clear(): Promise<void>;
  capture(tab: BrowserTab): Promise<CaptureSlot>;
  link(url: string, tabId: number | null): Promise<CaptureSlot>;
}
export interface Activity {
  activated(id: number): Promise<void>;
  removed(id: number): Promise<void>;
  reset(): Promise<void>;
}
export function createSlot(session: StorageArea, queue: WriteQueue, selection: SelectionAccess, now: () => string): Slot {
  // Capture reads the page before entering the queue, so slot writes can reach
  // it out of order. Each takes a ticket in the order the user acted, and a
  // write superseded by a later action is dropped rather than overwriting it.
  let issued = 0;
  let committed = 0;
  const commit = (ticket: number, value: CaptureSlot | null): Promise<boolean> => queue(async () => {
    if (ticket < committed) return false;
    committed = ticket;
    await session.set({ slot: value });
    return true;
  });
  return {
    read: (): Promise<CaptureSlot | null> => readSlot(session),
    clear: async (): Promise<void> => { await commit(++issued, null); },
    capture: async (tab: BrowserTab): Promise<CaptureSlot> => {
      const value = snapshot(tab, now());
      const ticket = ++issued;
      // Outside the queue: every other operation serializes through it, and
      // waiting on a slow page in there stalled the palette and copy recording
      // until the page finished loading.
      value.selection = tab.id === undefined ? null : await readSelection(selection, tab.id);
      return await commit(ticket, value) ? value : (await readSlot(session)) ?? value;
    },
    link: async (url: string, tabId: number | null): Promise<CaptureSlot> => {
      const target = httpUrl(url);
      if (!target) throw new Error('Link capture requires an HTTP(S) target');
      const value: CaptureSlot = { url: target, title: null, selection: null, sourceTabId: tabId, source: 'link', capturedAt: now() };
      await commit(++issued, value);
      return value;
    },
  };
}
export async function readActivity(session: StorageArea): Promise<number[]> {
  const value = (await session.get('activity')).activity;
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((id: unknown) => Number.isInteger(id))) throw new Error('Invalid activity');
  return value as number[];
}
export function createActivity(session: StorageArea, permission: PermissionAccess, queue: WriteQueue): Activity {
  return {
    activated: (id: number): Promise<void> => queue(async () => {
      if (!await permission.contains({ permissions: ['tabs'] })) return;
      // Bound session storage and sequential tab lookups when recent activations are ineligible.
      await session.set({ activity: [id, ...(await readActivity(session)).filter(value => value !== id)].slice(0, 50) });
    }),
    removed: (id: number): Promise<void> => queue(async () => {
      await session.set({ activity: (await readActivity(session)).filter(value => value !== id) });
    }),
    reset: (): Promise<void> => queue(() => session.set({ activity: [] })),
  };
}
