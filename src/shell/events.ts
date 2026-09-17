import type { Controller } from './controller.js';
import type { StorageArea, WriteQueue } from './storage.js';
import type { BrowserTab } from './slot.js';
import { createSlot } from './slot.js';

export interface SurfaceAccess {
  openPalette(route: { promptId?: string; query?: string }): Promise<void>;
  badge(text: string): Promise<void>;
  menu(): Promise<void>;
}
export interface EventHandlers {
  installed(reason: string): Promise<void>;
  command(name: string): Promise<void>;
  suggestions(query: string): Promise<{ content: string; description: string }[]>;
  entered(text: string): Promise<void>;
  link(url: string, tab?: BrowserTab): Promise<void>;
}
export function createEvents(controller: Controller, session: StorageArea, queue: WriteQueue,
  surfaces: SurfaceAccess, now: () => string): EventHandlers {
  const slot = createSlot(session, queue, { read: async (): Promise<null> => null }, now);
  const escape = (text: string): string => text.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char] ?? '');
  return {
    installed: async (reason: string): Promise<void> => {
      if (reason === 'install') await controller.seedStarter();
      await surfaces.menu();
    },
    command: async (name: string): Promise<void> => { if (name === 'open-palette') await surfaces.openPalette({}); },
    suggestions: async (query: string): Promise<{ content: string; description: string }[]> =>
      (await controller.search(query)).slice(0, 6).map(prompt => ({ content: `prompt:${prompt.id}`, description: escape(prompt.name) })),
    entered: async (text: string): Promise<void> => {
      const id = text.startsWith('prompt:') ? text.slice(7) : null;
      const exists = id !== null && (await controller.search('')).some(prompt => prompt.id === id);
      await surfaces.openPalette(exists && id !== null ? { promptId: id } : { query: text });
    },
    link: async (url: string, tab?: BrowserTab): Promise<void> => {
      if (tab?.incognito) throw new Error('Incognito capture is unavailable');
      await slot.link(url, tab?.id ?? null);
      await surfaces.badge('OK');
    },
  };
}
