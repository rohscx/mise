import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import type { ExportFile, FillContext, LocalState, Prompt } from '../src/shared/types.js';
import { importLibrary } from '../src/core/library.js';
import type { RegexExecutor, RegexJob } from '../src/core/rules.js';
import { isRecord } from '../src/core/schema.js';

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
export const execute: RegexExecutor = (rule, url): RegexJob => {
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const match = new RegExp(workerData.rule.regex, workerData.rule.flags).exec(workerData.url);
    parentPort.postMessage(match ? Object.fromEntries(Object.entries(match.groups || {}).filter(([, v]) => v !== undefined)) : null);
  `, { eval: true, workerData: { rule, url } });
  return {
    result: new Promise((resolve, reject) => {
      worker.once('error', reject);
      worker.once('message', (message: unknown) => {
        if (message === null) { resolve(null); return; }
        if (!isRecord(message)) { reject(new Error('Invalid worker result')); return; }
        const captures: Record<string, string> = Object.create(null);
        for (const [name, value] of Object.entries(message)) {
          if (typeof value !== 'string') { reject(new Error('Invalid capture')); return; }
          captures[name] = value;
        }
        resolve(captures);
      });
    }),
    terminate: () => { void worker.terminate(); },
  };
};
