import { expect, it } from 'vitest';
import { parseLibraryJson } from '../src/core/json.js';

it('detects escaped duplicate keys without confusing strings or separate objects', () => {
  expect(parseLibraryJson('{"a":1,"\\u0061":2}').ok).toBe(false);
  expect(parseLibraryJson('[{"a":1},{"a":2}]').ok).toBe(true);
  expect(parseLibraryJson('{"a":"\\\"key\\\": {} []", "b":true}').ok).toBe(true);
  expect(parseLibraryJson('{"a":"unterminated}').ok).toBe(false);
});
it('does not recurse on deeply nested untrusted JSON', () => {
  expect(parseLibraryJson('['.repeat(20000) + '0' + ']'.repeat(20000)).ok).toBe(true);
});
it('validates UTF-8 bytes and rejects byte-order marks', () => {
  expect(parseLibraryJson(new Uint8Array([0xff])).ok).toBe(false);
  expect(parseLibraryJson(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])).ok).toBe(false);
  expect(parseLibraryJson(new TextEncoder().encode('{"name":"名"}'))).toEqual({ ok: true, value: { name: '名' } });
});
