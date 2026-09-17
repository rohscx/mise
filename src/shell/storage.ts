import type { ContextStrategy, LocalState } from '../shared/types.js';
import { validateLibrary } from '../core/library.js';
import { isRecord } from '../core/schema.js';

export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  setAccessLevel?(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
}
export interface StorageAreas { local: StorageArea; session: StorageArea; sync: StorageArea }
export interface StoredState { revision: number; generation: number; syncEnabled: boolean; state: LocalState }
export type WriteQueue = <T>(operation: () => Promise<T>) => Promise<T>;
export function createWriteQueue(): WriteQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation);
    tail = result.catch(() => undefined);
    return result;
  };
}
// Rebuild dictionaries at every trust boundary, including browser deserialization.
export function safeClone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => safeClone(item)) as T;
  if (isRecord(value)) {
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, child] of Object.entries(value)) result[key] = safeClone(child);
    return result as T;
  }
  return value;
}
export function isStrategy(value: unknown): value is ContextStrategy {
  return value === 'capture' || value === 'last-non-chat' || value === 'tab-picker';
}
export function emptyState(): StoredState {
  return { revision: 0, generation: 0, syncEnabled: false, state: {
    library: { schemaVersion: 1, prompts: [], partials: [], siteRules: [] },
    usage: Object.create(null), remembered: Object.create(null), knownChatHosts: [], strategy: 'capture',
  } };
}
export async function readState(area: StorageArea): Promise<StoredState> {
  const raw = (await area.get('state')).state;
  if (raw === undefined) return emptyState();
  if (!isRecord(raw) || !Number.isSafeInteger(raw.revision) || !Number.isSafeInteger(raw.generation)
    || typeof raw.syncEnabled !== 'boolean' || !isRecord(raw.state)) throw new Error('Invalid stored state');
  const state = raw.state;
  if (!validateLibrary(state.library, 'draft').ok || !isStrategy(state.strategy)
    || !Array.isArray(state.knownChatHosts) || !state.knownChatHosts.every((v: unknown) => typeof v === 'string')
    || !isRecord(state.usage) || !isRecord(state.remembered)) throw new Error('Invalid stored state');
  for (const value of Object.values(state.usage)) {
    if (!isRecord(value) || typeof value.count !== 'number' || !Number.isSafeInteger(value.count) || value.count < 0
      || !(value.lastUsedAt === null || typeof value.lastUsedAt === 'string')) throw new Error('Invalid usage');
  }
  for (const values of Object.values(state.remembered)) {
    if (!isRecord(values) || !Object.values(values).every(v => typeof v === 'string')) throw new Error('Invalid remembered values');
  }
  return safeClone(raw) as unknown as StoredState;
}
export async function writeState(area: StorageArea, state: StoredState): Promise<void> {
  await area.set({ state: safeClone(state) });
}
export async function restrictStorage(areas: StorageAreas): Promise<void> {
  await Promise.all(Object.values(areas).map(async (area: StorageArea): Promise<void> => {
    if (typeof area.setAccessLevel === 'function') await area.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  }));
}
export async function publishStrategy(areas: StorageAreas, stored: StoredState): Promise<boolean> {
  if (!stored.syncEnabled) return true;
  try { await areas.sync.set({ strategy: stored.state.strategy }); return true; }
  catch { return false; }
}
