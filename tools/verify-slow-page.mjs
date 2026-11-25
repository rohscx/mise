// Regression check for "the extension locks up on heavy pages". Serves a page
// that stalls, captures it mid-stall, and queues a second operation behind the
// capture. Before the fix both waited for the page (~8 s); after it, capture
// takes milliseconds on a page still parsing and is capped near 750 ms on a
// page whose main thread is busy, and nothing queued behind it waits at all.
// Run with `npm run verify:slow-page`.
//
// activeTab is only granted by a real click on the toolbar icon, which headless
// Chrome cannot produce, so a throwaway copy of dist gains a host permission
// for 127.0.0.1. That changes who may inject, not when injection runs, so the
// timing measured is the one a user's click gets.
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cdp, launchBrowser, sleep } from './chrome-harness.mjs';

const STALL_MS = 8000;
// Generous against the fixed behaviour, far below the stall that was the bug.
const CAPTURE_LIMIT_MS = 2500;
const QUEUED_LIMIT_MS = 1000;
const PORT = Number(process.env.MISE_CDP_PORT ?? 9334);
const source = resolve(process.env.MISE_DIST ?? 'dist');

// 'parsing': HTML that keeps streaming, like a heavy page with a slow body.
// 'busy': parses instantly, then pins its main thread, like an app booting.
const pages = {
  parsing: res => {
    res.write('<!doctype html><html><head><title>Slow page</title></head><body><p>Loading');
    setTimeout(() => res.end('</p></body></html>'), STALL_MS);
  },
  busy: res => res.end(`<!doctype html><html><head><title>Busy page</title></head><body><p>Booting</p>
    <script>setTimeout(() => { const end = Date.now() + ${STALL_MS}; while (Date.now() < end) {} }, 0);</script></body></html>`),
};

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  (req.url.startsWith('/busy') ? pages.busy : pages.parsing)(res);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const pagePort = server.address().port;

const work = await mkdtemp(join(tmpdir(), 'mise-slow-'));
const dist = join(work, 'dist');
await cp(source, dist, { recursive: true });
const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://127.0.0.1/*'];
await writeFile(join(dist, 'manifest.json'), JSON.stringify(manifest));

const problems = [];
const browser = await launchBrowser(dist, PORT);
try {
  const options = await browser.open('options.html');
  await cdp(options.webSocketDebuggerUrl, async send => {
    await send('Runtime.enable');
    await sleep(1500);
    for (const mode of Object.keys(pages)) {
      // The slow page becomes the newest, active tab and is mid-stall when
      // the capture runs.
      await fetch(`http://127.0.0.1:${PORT}/json/new?http://127.0.0.1:${pagePort}/${mode}?${Date.now()}`, { method: 'PUT' });
      await sleep(400);
      const reply = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
        const timed = message => {
          const start = performance.now();
          return chrome.runtime.sendMessage(message).then(
            reply => ({ ms: Math.round(performance.now() - start), ok: reply?.ok === true, url: reply?.data?.url, error: reply?.error }),
            error => ({ ms: Math.round(performance.now() - start), ok: false, error: String(error) }));
        };
        const capture = timed({ type: 'capture' });
        await new Promise(r => setTimeout(r, 150));
        const queued = timed({ type: 'clear-capture' });
        return JSON.stringify({ capture: await capture, queued: await queued });
      })()` });
      if (reply.result?.exceptionDetails) {
        problems.push(`${mode} — ${reply.result.exceptionDetails.exception?.description ?? reply.result.exceptionDetails.text}`);
        continue;
      }
      const { capture, queued } = JSON.parse(reply.result.result.value);
      console.log(`${mode.padEnd(8)} capture ${String(capture.ms).padStart(5)} ms   queued op ${String(queued.ms).padStart(5)} ms`);
      if (!capture.ok) problems.push(`${mode} — capture failed: ${capture.error}`);
      else if (!capture.url?.includes(`/${mode}`)) problems.push(`${mode} — captured ${capture.url}, not the slow page`);
      if (capture.ms > CAPTURE_LIMIT_MS) problems.push(`${mode} — capture took ${capture.ms} ms; it is waiting for the page again`);
      if (!queued.ok) problems.push(`${mode} — queued operation failed: ${queued.error}`);
      if (queued.ms > QUEUED_LIMIT_MS) problems.push(`${mode} — an operation queued behind capture waited ${queued.ms} ms; capture is holding the queue again`);
    }
  });
} catch (error) {
  problems.push(`harness — ${error.message}`);
} finally {
  await browser.close();
  server.close();
  await rm(work, { recursive: true, force: true });
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('\nSlow pages no longer block the extension.');
