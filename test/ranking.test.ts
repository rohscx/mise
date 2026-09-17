import { describe, expect, it } from 'vitest';
import { buildSearchIndex, rankPrompts } from '../src/core/ranking.js';
import type { ExportFile, Prompt } from '../src/shared/types.js';
import { exampleUrl, library } from './fixtures.js';

function candidate(id: string, name = id, body = ''): Prompt {
  return { id, name, body, scope: [], tags: [], variables: [] };
}
function lib(prompts: Prompt[]): ExportFile { return { schemaVersion: 1, prompts, partials: [], siteRules: [] }; }

describe('search and deterministic ranking', () => {
  it('finds recursively included text and tags (18)', () => {
    expect(rankPrompts(buildSearchIndex(library()), 'loaded', null).slice(0, 2).map(r => r.prompt.id)).toEqual(['implement-ticket', 'ticket-summary']);
    expect(rankPrompts(buildSearchIndex(library()), 'SCOUT implementation', null).slice(0, 1).map(r => r.prompt.id)).toEqual(['implement-ticket']);
    expect(rankPrompts(buildSearchIndex(library()), 'review-only', null).some(r => r.prompt.id === 'review-github-pr')).toBe(true);
  });
  it('uses exact, prefix, substring, subsequence and absent scores per term', () => {
    const example = lib([candidate('a', 'cat'), candidate('b', 'catalog'), candidate('c', 'a cat'), candidate('d', 'coat'), candidate('e', 'dog')]);
    expect(rankPrompts(buildSearchIndex(example), 'cat', null).map(r => [r.prompt.id, r.score])).toEqual([['a', 4], ['b', 3], ['c', 2], ['d', 1]]);
    const prompt = candidate('a', 'cat', 'dog'); prompt.tags = ['bird'];
    expect(rankPrompts(buildSearchIndex(lib([prompt])), 'CAT dog bird', null)[0]?.score).toBe(12);
    expect(rankPrompts(buildSearchIndex(lib([prompt])), 'cat elephant', null)).toEqual([]);
    expect(rankPrompts(buildSearchIndex(example), ' \t ', null).every(r => r.score === 0)).toBe(true);
  });
  it('scope beats score and usage but never hides unscoped or other-site results (18)', () => {
    const scoped = candidate('a', 'coat'); scoped.scope = ['https://jira.example.com/*'];
    const exact = candidate('b', 'cat');
    const usage = { b: { count: 999, lastUsedAt: '2026-09-17T12:00:00Z' } };
    expect(rankPrompts(buildSearchIndex(lib([exact, scoped])), 'cat', exampleUrl, usage).map(r => r.prompt.id)).toEqual(['a', 'b']);
    expect(rankPrompts(buildSearchIndex(lib([exact, scoped])), 'cat', null, usage).map(r => r.prompt.id)).toEqual(['b', 'a']);
    expect(rankPrompts(buildSearchIndex(library()), '', 'https://github.com/a/b/pull/1')[0]?.prompt.id).toBe('review-github-pr');
    expect(rankPrompts(buildSearchIndex(library()), '', null)).toHaveLength(4);
  });
  it('sorts by score before recency, then count, name and ID with unused times last', () => {
    const example = lib(['a', 'b', 'c', 'd', 'e'].map(id => candidate(id, 'same')));
    const usage = {
      a: { count: 100, lastUsedAt: null }, b: { count: 99, lastUsedAt: '2025-01-01T00:00:00Z' },
      c: { count: 1, lastUsedAt: '2026-01-01T00:00:00Z' }, d: { count: 2, lastUsedAt: '2026-01-01T00:00:00Z' },
    };
    expect(rankPrompts(buildSearchIndex(example), '', null, usage).map(r => r.prompt.id)).toEqual(['d', 'c', 'b', 'a', 'e']);
    expect(rankPrompts(buildSearchIndex(lib([candidate('b', 'same'), candidate('a', 'same')])), '', null).map(r => r.prompt.id)).toEqual(['a', 'b']);
    expect(rankPrompts(buildSearchIndex(lib([candidate('a', '🀀'), candidate('b', '\uE000'), candidate('c', 'Z'), candidate('d', 'a')])), '', null)
      .map(r => r.prompt.id)).toEqual(['c', 'd', 'b', 'a']);
    expect(rankPrompts(buildSearchIndex(lib([candidate('a', 'cat'), candidate('b', 'coat')])), 'cat', null, usage)[0]?.prompt.id).toBe('a');
  });
});
