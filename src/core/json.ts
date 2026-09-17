import type { Validation } from './schema.js';

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export function parseLibraryJson(input: string | Uint8Array): Validation<unknown> {
  const fail = (message: string): Validation<unknown> => ({ ok: false, issues: [{ path: '$', message }] });
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  if (bytes.length > MAX_IMPORT_BYTES) return fail('Import exceeds 5 MiB');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return fail('Import must be valid UTF-8'); }
  if (text.startsWith('\uFEFF')) return fail('UTF-8 BOM is not allowed');
  try {
    // JSON.parse handles grammar; this separate scan retains keys before they can be overwritten.
    const stack: (Set<string> | null)[] = [];
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '{') stack.push(new Set());
      else if (char === '[') stack.push(null);
      else if (char === '}' || char === ']') stack.pop();
      else if (char === '"') {
        const start = i++;
        for (; i < text.length; i++) {
          if (text[i] === '\\') i++;
          else if (text[i] === '"') break;
        }
        let next = i + 1;
        while (/\s/.test(text[next] ?? '') && next < text.length) next++;
        if (text[next] === ':') {
          const key: unknown = JSON.parse(text.slice(start, i + 1));
          const keys = stack[stack.length - 1];
          if (typeof key === 'string' && keys) {
            if (keys.has(key)) return fail('Duplicate JSON object key');
            keys.add(key);
          }
        }
      }
    }
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch { return fail('Malformed JSON'); }
}
