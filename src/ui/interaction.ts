import type { CaptureSlot, ContextStrategy } from '../shared/types.js';

export function canClearCapture(slot: CaptureSlot | null): boolean {
  return slot !== null;
}

export function inputValues(entries: Iterable<readonly [string, string]>): Record<string, string> {
  const values: Record<string, string> = Object.create(null);
  for (const [name, value] of entries) values[name] = value;
  return values;
}
export interface RowState { current: boolean; cursor: boolean }
// Two states, because the list shows both at once: `current` is the prompt
// actually loaded into the fill panel, `cursor` is where the keyboard is. They
// diverge as soon as someone arrows away from what they selected.
export function rowStates(ids: readonly string[], cursor: number, loadedId: string | null): RowState[] {
  return ids.map((id, index) => ({ current: loadedId !== null && id === loadedId, cursor: index === cursor }));
}
export function searchSelection(current: number, key: string, count: number): number {
  if (!count) return -1;
  return Math.max(0, Math.min(count - 1, current + (key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0)));
}
export interface CopyEffects {
  write(text: string): Promise<void>;
  announce(message: string): void;
  remember(): Promise<void>;
}
export async function copyFill(text: string, effects: CopyEffects): Promise<void> {
  try { await effects.write(text); }
  catch { effects.announce('Copy failed'); return; }
  effects.announce('Copied. Paste into your chat.');
  try { await effects.remember(); }
  catch { effects.announce('Copied. Paste into your chat. Usage and remembered values were not saved.'); }
}
export function sourceText(source: CaptureSlot, strategy: ContextStrategy, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(source.capturedAt)) / 1000));
  const age = seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h`;
  return `${source.url}\n${strategy} · ${source.source} · ${age} ago`;
}
