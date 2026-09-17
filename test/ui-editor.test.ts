import { describe, expect, it } from 'vitest';
import { analyzeEditor, consumerDiagnostics, draftSave, libraryDiagnostics, prepareImport, referenceCount } from '../src/ui/editor.js';
import { createController } from '../src/shell/controller.js';
import { readState } from '../src/shell/storage.js';
import { exportLibrary } from '../src/core/library.js';
import { harness, sender } from './shell-fixtures.js';
import { library } from './fixtures.js';

function draft(): ReturnType<typeof library> {
  const input = library();
  input.prompts = [{ id: 'draft', name: 'Draft', body: '{{> outer}}', tags: [], scope: [], variables: [] }];
  input.partials = [{ name: 'outer', body: '{{> inner}}' }, { name: 'inner', body: 'line one\n{{bad token}} {{unknown}}' }];
  return input;
}
const singlePrompt = { id: 'one', name: 'One', body: 'Just {{url}}', tags: [], scope: [], variables: [] };

describe('options editor', () => {
  it('saves erroneous drafts through the existing worker, without a persisted draft flag', async () => {
    const input = draft(), deps = harness(), controller = createController(deps);
    expect(analyzeEditor(input, { kind: 'prompt', name: 'draft' }).draft).toBe(true);
    expect(await controller.handle(draftSave(input, 0), sender)).toMatchObject({ ok: true });
    expect((await readState(deps.areas.local)).state.library).toEqual(input);
    expect(exportLibrary(input).ok).toBe(false);
    expect(Object.keys(input.prompts[0] ?? {})).not.toContain('draft');
  });
  it('names the nested inclusion path and token line/column for syntax and unknown variables', () => {
    const result = analyzeEditor(draft(), { kind: 'prompt', name: 'draft' });
    expect(result.diagnostics).toContain('partial:inner:2:1: syntax {{bad token}}; path draft -> outer -> inner');
    expect(result.diagnostics).toContain('partial:inner:2:15: Unknown variable unknown; path draft -> outer -> inner');
  });
  it('reports missing partials and cycles with their inclusion paths', () => {
    const input = draft(); input.partials = [{ name: 'outer', body: '{{> absent}}' }];
    expect(libraryDiagnostics(input).join('\n')).toContain('draft -> outer -> absent');
    input.partials = [{ name: 'outer', body: '{{> inner}}' }, { name: 'inner', body: '{{> outer}}' }];
    expect(libraryDiagnostics(input).join('\n')).toContain('cycle outer; path draft -> outer -> inner -> outer');
  });
  it('counts distinct direct consumers, including partial-to-partial references and ignoring escapes', () => {
    const input = draft();
    input.prompts.push({ id: 'second', name: 'Second', body: '{{> inner}} {{> inner}} \\{{> outer}}', tags: [], scope: [], variables: [] });
    expect(referenceCount(input, 'inner')).toBe(2);
    expect(referenceCount(input, 'outer')).toBe(1);
  });
  it('revalidates consumers after a partial edit and leaves unused partial free names available', () => {
    const input = draft(); input.partials = [{ name: 'outer', body: '{{url}}' }, { name: 'unused', body: '{{free}}' }];
    expect(libraryDiagnostics(input)).toEqual([]);
    input.partials[0] = { name: 'outer', body: '{{new_input}}' };
    expect(libraryDiagnostics(input).join('\n')).toContain('Unknown variable new_input; path draft -> outer');
    expect(consumerDiagnostics(input, 'outer').join('\n')).toContain('Unknown variable new_input; path draft -> outer');
    expect(consumerDiagnostics(input, 'unused')).toEqual([]);
  });
  it('previews escapes, free defaults, context placeholders and inert markup without reparsing', () => {
    const input = draft(); input.partials = [];
    input.prompts = [{ id: 'preview', name: 'Preview', body: '\\{{literal}} {{url}} {{focus}} <img src=x>', tags: [], scope: [],
      variables: [{ kind: 'free', name: 'focus', label: 'Focus', defaultValue: '{{untouched}}', rememberLast: false }] }];
    expect(analyzeEditor(input, { kind: 'prompt', name: 'preview' })).toMatchObject({ draft: false, diagnostics: [],
      preview: '{{literal}} ⟦url⟧ {{untouched}} <img src=x>' });
  });
  it('snapshots a save so later edits cannot change an in-flight request', () => {
    const input = draft(), request = draftSave(input, 4); input.partials = [];
    expect(request.revision).toBe(4); expect(request.library.partials).toHaveLength(2);
  });
  it('previews replacement counts and rejects invalid import without touching the saved library', async () => {
    const deps = harness(), controller = createController(deps);
    await controller.handle(draftSave(library(), 0), sender);
    const before = await readState(deps.areas.local), text = JSON.stringify(draft());
    expect(prepareImport(text).ok).toBe(false);
    expect(await controller.handle({ type: 'import', revision: 1, text }, sender)).toMatchObject({ ok: false });
    expect(await readState(deps.areas.local)).toEqual(before);
    expect(prepareImport(JSON.stringify(library()))).toMatchObject({ ok: true,
      value: { summary: '4 prompts, 4 partials, 2 site rules' } });
    expect(prepareImport(JSON.stringify({ schemaVersion: 1, prompts: [singlePrompt], partials: [], siteRules: [] })))
      .toMatchObject({ ok: true, value: { summary: '1 prompt, 0 partials, 0 site rules' } });
  });
});
