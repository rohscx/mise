import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { createRegexExecutor } from '../src/shell/regex-worker.js';
import type { DisposableWorker } from '../src/shell/regex-worker.js';
import { evaluateRules } from '../src/core/rules.js';

async function workerCode(): Promise<string> {
  const result = await build({ stdin: { contents: `
    import { parentPort } from 'node:worker_threads';
    import { attachRegexWorker } from './src/shell/regex-runtime.ts';
    const port = { onmessage: null, postMessage: value => parentPort.postMessage(value) };
    attachRegexWorker(port);
    parentPort.on('message', data => port.onmessage({ data }));
  `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false });
  const output = result.outputFiles[0]; if (!output) throw new Error('Worker build failed'); return output.text;
}
describe('real disposable regex worker', () => {
  it('distinguishes readiness from captures and null results', async () => {
    for (const response of [{ ready: 'ready' }, null]) {
      const port: DisposableWorker = { onmessage: null, onerror: null, postMessage: vi.fn(), terminate: vi.fn() };
      const job = createRegexExecutor(() => port)({ id: 'test', match: 'https://*/*', regex: 'x', flags: '' }, 'https://example.com');
      const resolved = vi.fn();
      void job.result.then(resolved);
      try {
        port.onmessage?.({ data: 'ready' });
        await job.ready;
        expect(resolved).not.toHaveBeenCalled();
        port.onmessage?.({ data: response });
        expect(await job.result).toEqual(response);
      } finally { job.terminate(); }
      expect(port.terminate).toHaveBeenCalledOnce();
    }
  });
  it('returns named captures including __proto__ and terminates the actual worker', async () => {
    const code = await workerCode(); const exits: Promise<number>[] = [];
    const execute = createRegexExecutor((): DisposableWorker => {
      const worker = new Worker(code, { eval: true });
      exits.push(new Promise(resolve => worker.once('exit', resolve)));
      const port: DisposableWorker = { onmessage: null, onerror: null,
        postMessage: (value): void => worker.postMessage(value), terminate: (): void => { void worker.terminate(); } };
      worker.on('message', (data: unknown) => port.onmessage?.({ data }));
      worker.on('error', (error: Error) => port.onerror?.(error)); return port;
    });
    const job = execute({ id: 'test', match: 'https://*/*', regex: '(?<__proto__>ticket)', flags: '' }, 'https://example.com/ticket');
    try {
      await job.ready;
      const result = await job.result;
      expect(result?.['__proto__']).toBe('ticket'); expect(Object.getPrototypeOf(result)).toBeNull();
    } finally { job.terminate(); }
    expect(await Promise.all(exits)).toHaveLength(1);
  });
  it('times out a catastrophic regex without blocking and kills its thread', async () => {
    const code = await workerCode(); const worker = new Worker(code, { eval: true });
    await new Promise<void>(resolve => worker.once('online', resolve));
    const exited = new Promise<number>(resolve => worker.once('exit', resolve));
    let terminated = false;
    const port: DisposableWorker = { onmessage: null, onerror: null,
      postMessage: (value): void => worker.postMessage(value), terminate: (): void => { terminated = true; void worker.terminate(); } };
    worker.on('message', (data: unknown) => port.onmessage?.({ data }));
    worker.on('error', (error: Error) => port.onerror?.(error));
    const started = performance.now();
    try {
      const result = await evaluateRules([{ id: 'catastrophic', match: 'https://*/*', regex: '(a+)+$', flags: '' }],
        `https://example.com/${'a'.repeat(10000)}!`, createRegexExecutor(() => port));
      expect(result.problem).toEqual({ code: 'timeout', ruleId: 'catastrophic' });
      expect(terminated).toBe(true); expect(performance.now() - started).toBeLessThan(1500);
      await exited;
    } finally { await worker.terminate(); }
  }, 5000);
});
