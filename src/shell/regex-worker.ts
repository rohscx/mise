import type { RegexExecutor, RegexJob } from '../core/rules.js';
import { isRecord } from '../core/schema.js';

export interface DisposableWorker {
  postMessage(value: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  terminate(): void;
}
export type WorkerFactory = () => DisposableWorker;
// The document supplies new Worker(packagedUrl, { type: 'module' }); Node tests supply worker_threads.
// The service worker cannot construct Web Workers. No regex ever executes on its event loop.
export function createRegexExecutor(createWorker: WorkerFactory): RegexExecutor {
  return (rule, url): RegexJob => {
    const worker = createWorker();
    let stopped = false;
    let cancel: () => void = () => undefined;
    const terminate = (): void => {
      if (stopped) return;
      stopped = true;
      worker.terminate();
      cancel();
    };
    const result = new Promise<Record<string, string> | null>((resolve, reject) => {
      cancel = () => resolve(null);
      worker.onmessage = ({ data }): void => {
        if (data === null) { resolve(null); return; }
        if (!isRecord(data)) { reject(new Error('Invalid regex worker response')); return; }
        const captures: Record<string, string> = Object.create(null);
        for (const [key, value] of Object.entries(data)) {
          if (typeof value !== 'string') { reject(new Error('Invalid regex capture')); return; }
          captures[key] = value;
        }
        resolve(captures);
      };
      worker.onerror = (): void => reject(new Error('Regex worker failed'));
      try { worker.postMessage({ regex: rule.regex, flags: rule.flags, url }); }
      catch { reject(new Error('Regex worker unavailable')); }
    });
    // The core owns the aggregate 100 ms budget and invokes terminate in finally.
    return { result, terminate };
  };
}

export function browserRegexExecutor(packagedUrl: string): RegexExecutor {
  return createRegexExecutor((): DisposableWorker => {
    const worker = new Worker(packagedUrl, { type: 'module' });
    const port: DisposableWorker = { onmessage: null, onerror: null,
      postMessage: (value: unknown): void => worker.postMessage(value), terminate: (): void => worker.terminate() };
    worker.onmessage = (event: MessageEvent<unknown>): void => { port.onmessage?.({ data: event.data }); };
    worker.onerror = (): void => { port.onerror?.(null); };
    return port;
  });
}
