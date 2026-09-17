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
  return {
    read: (): Promise<CaptureSlot | null> => readSlot(session),
    clear: (): Promise<void> => queue(() => session.set({ slot: null })),
    capture: (tab: BrowserTab): Promise<CaptureSlot> => queue(async () => {
      const value = snapshot(tab, now());
      try { value.selection = tab.id === undefined ? null : await selection.read(tab.id); }
      catch { value.selection = null; }
      await session.set({ slot: value });
      return value;
    }),
    link: (url: string, tabId: number | null): Promise<CaptureSlot> => queue(async () => {
      const target = httpUrl(url);
      if (!target) throw new Error('Link capture requires an HTTP(S) target');
      const value: CaptureSlot = { url: target, title: null, selection: null, sourceTabId: tabId, source: 'link', capturedAt: now() };
      await session.set({ slot: value });
      return value;
    }),
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
