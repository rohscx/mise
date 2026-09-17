import { attachRegexWorker } from './shell/regex-runtime.js';
import type { RegexPort } from './shell/regex-runtime.js';

const port: RegexPort = { onmessage: null, postMessage: (value: unknown): void => self.postMessage(value) };
attachRegexWorker(port);
self.onmessage = (event: MessageEvent<unknown>): void => { port.onmessage?.({ data: event.data }); };
