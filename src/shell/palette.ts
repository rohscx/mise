import { isRecord } from '../core/schema.js';
import type { StorageArea, WriteQueue } from './storage.js';

export interface Invocation { promptId?: string; query?: string }
export interface PaletteWindows {
  getAll(options: { populate: boolean; windowTypes: ['popup'] }): Promise<{ id?: number | undefined; tabs?: { url?: string | undefined }[] | undefined }[]>;
  update(id: number, options: { focused: boolean }): Promise<unknown>;
  create(options: { url: string; type: 'popup'; width: number; height: number }): Promise<unknown>;
}
export function parseInvocation(raw: unknown): Invocation {
  if (!isRecord(raw)) return {};
  if (typeof raw.promptId === 'string') return { promptId: raw.promptId };
  if (typeof raw.query === 'string') return { query: raw.query };
  return {};
}
export function openPalette(windows: PaletteWindows, session: StorageArea, queue: WriteQueue,
  url: string, route: Invocation): Promise<void> {
  return queue(async () => {
    await session.set({ invocation: route });
    const open = await windows.getAll({ populate: true, windowTypes: ['popup'] });
    const existing = open.find(window => window.tabs?.some(tab => tab.url === url));
    if (existing?.id !== undefined) await windows.update(existing.id, { focused: true });
    else await windows.create({ url, type: 'popup', width: 520, height: 640 });
  });
}
