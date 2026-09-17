import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import type { ExportFile, FillContext, LocalState, Prompt } from '../src/shared/types.js';
import { importLibrary } from '../src/core/library.js';
import type { RegexExecutor } from '../src/core/rules.js';
import { createRegexExecutor, type DisposableWorker } from '../src/shell/regex-worker.js';

export const exampleUrl = 'https://jira.example.com/projects/OPS/queues/custom/43/OPS-4821';
export function library(): ExportFile {
  const result = importLibrary(readFileSync(new URL('../examples/prompts.example.json', import.meta.url), 'utf8'));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}
export function prompt(id: string): Prompt {
  const value = library().prompts.find(p => p.id === id);
  if (!value) throw new Error('Fixture prompt missing');
  return value;
}
export function context(url: string = exampleUrl): FillContext {
  return { strategy: 'capture', source: { url, title: null, selection: null, sourceTabId: 42,
    source: 'tab', capturedAt: '2026-09-17T12:00:00Z' }, date: '2026-09-17', clipboard: null };
}
export function state(): LocalState {
  return { library: library(), usage: {}, remembered: {}, knownChatHosts: [], strategy: 'capture' };
}
// This test adapter exercises the disposable-worker contract without browser APIs.
export const execute: RegexExecutor = createRegexExecutor((): DisposableWorker => {
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    parentPort.on('message', ({ regex, flags, url }) => {
      const match = new RegExp(regex, flags).exec(url);
      parentPort.postMessage(match ? Object.fromEntries(Object.entries(match.groups || {}).filter(([, v]) => v !== undefined)) : null);
    });
    parentPort.postMessage('ready');
  `, { eval: true });
  const port: DisposableWorker = { onmessage: null, onerror: null,
    postMessage: value => worker.postMessage(value), terminate: () => { void worker.terminate(); } };
  worker.on('message', (data: unknown) => port.onmessage?.({ data }));
  worker.on('error', (error: Error) => port.onerror?.(error));
  return port;
});
