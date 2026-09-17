import type { StorageArea, StorageAreas } from '../src/shell/storage.js';
import { createWriteQueue } from '../src/shell/storage.js';
import type { BrowserTab } from '../src/shell/slot.js';
import type { ControllerDependencies } from '../src/shell/controller.js';

export class MemoryArea implements StorageArea {
  data: Record<string, unknown> = Object.create(null);
  writes = 0;
  fail = false;
  access: string | null = null;
  async get(key: string): Promise<Record<string, unknown>> { return structuredClone({ [key]: this.data[key] }); }
  async set(values: Record<string, unknown>): Promise<void> {
    if (this.fail) throw new Error('QUOTA_BYTES');
    this.writes++;
    for (const [key, value] of Object.entries(values)) Object.defineProperty(this.data, key,
      { value: structuredClone(value), enumerable: true, writable: true, configurable: true });
  }
  async setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void> { this.access = options.accessLevel; }
}
export interface Harness extends ControllerDependencies {
  areas: StorageAreas & { local: MemoryArea; session: MemoryArea; sync: MemoryArea };
  allowed: boolean;
  current: number;
  records: Map<number, BrowserTab>;
  selected: number[];
}
export function harness(): Harness {
  const areas = { local: new MemoryArea(), session: new MemoryArea(), sync: new MemoryArea() };
  const deps: Harness = {
    notify: async (): Promise<void> => undefined, areas, session: areas.session, queue: createWriteQueue(), allowed: true, current: 1, selected: [],
    records: new Map([[1, { id: 1, windowId: 1, incognito: false, url: 'https://ticket.example/a', title: 'Ticket A' }]]),
    permissions: { contains: async (): Promise<boolean> => deps.allowed },
    tabs: {
      get: async (id: number): Promise<BrowserTab> => {
        const value = deps.records.get(id); if (!value) throw new Error('Tab closed'); return structuredClone(value);
      },
      query: async (query): Promise<BrowserTab[]> => [...deps.records.values()].filter(tab => !query.active || tab.id === deps.current),
    },
    windows: { getLastFocused: async (): Promise<{ tabs: BrowserTab[] }> => ({ tabs: [...deps.records.values()].map(tab => ({ ...tab, active: tab.id === deps.current })) }), get: async (id: number): Promise<{ type: string; incognito: boolean }> => ({ type: id === 1 ? 'normal' : 'popup', incognito: false }) },
    now: (): string => '2026-09-17T12:00:00.000Z', origin: 'chrome-extension://mise/', extensionId: 'mise',
    selection: { read: async (id: number): Promise<string> => { deps.selected.push(id); return 'selected'; } },
  };
  return deps;
}
export const sender = { id: 'mise', url: 'chrome-extension://mise/options.html' };
