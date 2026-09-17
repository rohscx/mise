import type { Request } from '../shared/messages.js';
import { isRecord } from '../core/schema.js';
import { validateLibrary } from '../core/library.js';
import { isStrategy, safeClone } from './storage.js';

export interface Sender { id?: string | undefined; url?: string | undefined; tab?: unknown }
export function trustedSender(sender: Sender, extensionId: string, origin: string): boolean {
  if (sender.id !== extensionId || sender.tab !== undefined || !sender.url) return false;
  return sender.url.startsWith(origin) && ['popup.html', 'palette.html', 'options.html'].includes(
    sender.url.slice(origin.length).split(/[?#]/)[0] ?? '');
}
export function parseRequest(raw: unknown): Request {
  if (!isRecord(raw) || typeof raw.type !== 'string') throw new Error('Invalid request');
  const keys: Record<string, string[]> = Object.assign(Object.create(null), {
    state: ['type'], slot: ['type'], invocation: ['type'], capture: ['type'], 'clear-capture': ['type'], tabs: ['type', 'query'], search: ['type', 'query'],
    fill: ['type', 'promptId', 'tabId'], save: ['type', 'revision', 'library'], import: ['type', 'revision', 'text'],
    export: ['type'], settings: ['type', 'revision', 'strategy', 'knownChatHosts', 'syncEnabled'],
    copied: ['type', 'revision', 'generation', 'promptId', 'values'],
  });
  const allowed = keys[raw.type];
  if (!allowed || Object.keys(raw).some(key => !allowed.includes(key))
    || allowed.some(key => key !== 'tabId' && !Object.hasOwn(raw, key))) throw new Error('Invalid request fields');
  for (const key of ['revision', 'generation', 'tabId']) {
    if (Object.hasOwn(raw, key) && (typeof raw[key] !== 'number' || !Number.isSafeInteger(raw[key]) || raw[key] < 0)) throw new Error('Invalid request number');
  }
  for (const key of ['query', 'text', 'promptId']) {
    if (Object.hasOwn(raw, key) && typeof raw[key] !== 'string') throw new Error('Invalid request string');
  }
  if (raw.type === 'save' && !validateLibrary(raw.library, 'draft').ok) throw new Error('Invalid library');
  if (raw.type === 'settings' && (!isStrategy(raw.strategy) || typeof raw.syncEnabled !== 'boolean'
    || !Array.isArray(raw.knownChatHosts) || !raw.knownChatHosts.every(validHost))) throw new Error('Invalid settings');
  if (raw.type === 'copied' && (!isRecord(raw.values) || !Object.values(raw.values).every(v => typeof v === 'string'))) throw new Error('Invalid free values');
  return safeClone(raw) as unknown as Request;
}
export function validHost(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value !== value.toLowerCase() || /[\s/*:@?#\\]/.test(value)) return false;
  try { return new URL(`https://${value}`).hostname === value; } catch { return false; }
}
