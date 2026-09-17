import { isRecord } from '../core/schema.js';

export interface RegexPort {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(value: unknown): void;
}
export function attachRegexWorker(port: RegexPort): void {
  port.onmessage = ({ data }): void => {
    if (!isRecord(data) || typeof data.regex !== 'string' || data.regex.length > 8192
      || (data.flags !== '' && data.flags !== 'i') || typeof data.url !== 'string'
      || new TextEncoder().encode(data.url).length > 16 * 1024) throw new Error('Invalid regex job');
    const match = new RegExp(data.regex, data.flags).exec(data.url);
    const captures: Record<string, string> = Object.create(null);
    if (match) for (const [key, value] of Object.entries(match.groups ?? {})) if (value !== undefined) captures[key] = value;
    port.postMessage(match ? captures : null);
  };
  port.postMessage('ready');
}
