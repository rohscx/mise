import { expect, it } from 'vitest';
import { isRecord, validateShape } from '../src/core/schema.js';
import { library } from './fixtures.js';

it('narrows untrusted objects and reconstructs detached typed records', () => {
  expect(isRecord(null)).toBe(false);
  expect(isRecord([])).toBe(false);
  expect(isRecord({})).toBe(true);
  const input = library();
  const validated = validateShape(input);
  expect(validated.ok).toBe(true);
  if (validated.ok) {
    input.prompts.length = 0;
    expect(validated.value.prompts).toHaveLength(4);
  }
});
it('requires every persisted field and rejects unknown fields at every level', () => {
  const input = library();
  for (const field of Object.keys(input)) {
    expect(validateShape(Object.fromEntries(Object.entries(input).filter(([key]) => key !== field))).ok).toBe(false);
  }
  expect(validateShape({ ...input, partials: [{ name: 'x', body: '', extra: '' }] }).ok).toBe(false);
  expect(validateShape({ ...input, siteRules: [{ id: 'x', match: 'https://*/*', regex: '.', flags: '', extra: '' }] }).ok).toBe(false);
});
