// Loads the built extension into a throwaway Chrome profile and asserts what
// only a real browser can tell us. Every check here exists because a bug of
// that exact shape reached a green unit-test suite: a storage method the fakes
// had and Chrome did not, a sender shape the fakes never produced, and a
// viewport-relative width that collapsed the popup. Run with `npm run verify:chrome`.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cdp, evaluate, launchBrowser, seedStorage, sleep } from './chrome-harness.mjs';

const DIST = process.env.MISE_DIST ?? 'dist';
const PORT = Number(process.env.MISE_CDP_PORT ?? 9333);
const problems = [];
const notes = [];

// Errors and warnings from any execution context, however they are reported.
function collector(sink) {
  return message => {
    const { method, params } = message;
    if (method === 'Runtime.exceptionThrown') {
      sink.push(`EXCEPTION: ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`);
    }
    if (method === 'Log.entryAdded' && ['error', 'warning'].includes(params.entry.level)) {
      sink.push(`${params.entry.level.toUpperCase()}: ${params.entry.text}`);
    }
    if (method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(params.type)) {
      sink.push(`console.${params.type}: ${params.args.map(arg => arg.value ?? arg.description).join(' ')}`);
    }
  };
}

const browser = await launchBrowser(DIST, PORT);
const { open, extensionId, absolute } = browser;

try {
  notes.push(`Extension ${extensionId} loaded from ${absolute}`);

  const manifestEarly = JSON.parse(await readFile(join(DIST, 'manifest.json'), 'utf8'));
  // Seed from an extension page: it has the same storage access as the worker,
  // needs no target discovery, and wakes the worker on the way.
  const library = JSON.parse(await readFile(join(DIST, '..', 'examples/prompts.example.json'), 'utf8'));
  const slot = {
    url: 'https://jira.example.com/projects/OPS/queues/custom/43/OPS-4821',
    title: 'OPS-4821 Session tokens survive a queue failover',
    selection: 'Rotation should invalidate the previous key once every worker reports the new one.',
    sourceTabId: null, source: 'tab', capturedAt: new Date().toISOString(),
  };
  const seeded = await seedStorage(open, library, slot, manifestEarly.options_ui?.page);
  if (seeded !== library.prompts.length) {
    problems.push(`seed — ${seeded}; expected ${library.prompts.length} prompts. The extension is not installed or has no API access.`);
  }

  // The worker is awake now, so its target exists and its logs are readable.
  let worker = null;
  for (let attempt = 0; attempt < 20 && !worker; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      worker = targets.find(t => t.type === 'service_worker' && t.url.includes(extensionId));
    } catch { /* transient */ }
    if (!worker) await sleep(300);
  }
  if (!worker) notes.push('Service worker dormant; no worker log check.');
  else {
    const workerLogs = [];
    await cdp(worker.webSocketDebuggerUrl, async send => {
      await send('Runtime.enable');
      await send('Log.enable');
      await sleep(1200);
    }, collector(workerLogs));
    if (workerLogs.length) problems.push(...workerLogs.map(line => `service worker — ${line}`));
    else notes.push('Service worker started clean.');
  }

  const manifest = manifestEarly;
  const popup = await open(manifest.action.default_popup);
  const popupLogs = [];
  await cdp(popup.webSocketDebuggerUrl, async send => {
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Page.enable');
    // Chrome opens a popup with a near-zero viewport and sizes it to the
    // content, so a body that yields to the viewport collapses to a sliver.
    await send('Emulation.setDeviceMetricsOverride', { width: 120, height: 600, deviceScaleFactor: 1, mobile: false });
    await sleep(1200);
    const width = await evaluate(send, 'Math.round(document.body.getBoundingClientRect().width)');
    notes.push(`Body width under a 120px viewport: ${width}px`);
    if (width < 360) problems.push(`popup — body collapsed to ${width}px; a real popup renders as a sliver.`);

    await send('Emulation.setDeviceMetricsOverride', { width: 380, height: 600, deviceScaleFactor: 1, mobile: false });
    await sleep(1500);

    // Select a row other than the first: the highlight must follow the prompt
    // that actually loads, and the panel must not be torn down in between.
    const interaction = await evaluate(send, `(async () => {
      const rows = () => [...document.querySelectorAll('.results button')];
      if (rows().length < 3) return JSON.stringify({ error: 'fewer than three prompts listed' });
      rows()[0].click();
      await new Promise(r => setTimeout(r, 1200));
      const panel = document.getElementById('fill');
      let vanished = false;
      const watch = setInterval(() => { if (panel.hidden) vanished = true; }, 16);
      rows()[2].click();
      await new Promise(r => setTimeout(r, 1400));
      clearInterval(watch);
      const size = id => { const el = document.getElementById(id); return el && !el.hidden ? Math.round(el.getBoundingClientRect().height) : 0; };
      return JSON.stringify({
        loaded: document.getElementById('prompt-name').textContent.trim(),
        highlighted: rows().filter(b => b.getAttribute('aria-current') === 'true').map(b => b.textContent.trim()),
        panelVanished: vanished,
        sourceRows: [...document.querySelectorAll('.source')].filter(e => !e.hidden && e.getBoundingClientRect().height > 0).length,
        preview: size('preview'), results: size('results'),
        overflow: Math.max(0, document.body.scrollHeight - document.body.clientHeight),
      });
    })()`, true);
    notes.push(`Popup interaction: ${interaction}`);
    try {
      const seen = JSON.parse(interaction);
      if (seen.error) problems.push(`popup — ${seen.error}`);
      if (seen.highlighted?.length !== 1 || seen.highlighted[0] !== seen.loaded) {
        problems.push(`popup — highlight on ${JSON.stringify(seen.highlighted)} but ${JSON.stringify(seen.loaded)} is loaded.`);
      }
      if (seen.panelVanished) problems.push('popup — the fill panel was hidden mid-selection; the popup visibly collapses.');
      if (seen.sourceRows > 1) problems.push(`popup — the source URL is shown ${seen.sourceRows} times at once.`);
      if (seen.preview < seen.results) problems.push(`popup — preview (${seen.preview}px) is smaller than the result list (${seen.results}px).`);
      if (seen.overflow > 1) problems.push(`popup — content overflows by ${seen.overflow}px; bottom controls collide or clip.`);
    } catch { problems.push('popup — could not read the interaction result.'); }
  }, collector(popupLogs));
  if (popupLogs.length) problems.push(...popupLogs.map(line => `popup — ${line}`));
  else notes.push('Popup loaded clean: no console errors, no CSP violations.');

  const optionsPath = manifest.options_ui?.page ?? manifest.options_page;
  if (!optionsPath) problems.push('manifest — no options page is declared.');
  else {
    const options = await open(optionsPath);
    const optionsLogs = [];
    await cdp(options.webSocketDebuggerUrl, async send => {
      await send('Runtime.enable');
      await send('Log.enable');
      await send('Page.enable');
      await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 850, deviceScaleFactor: 1, mobile: false });
      await sleep(2200);
      const shape = await evaluate(send, `JSON.stringify({
        controls: document.querySelectorAll('button, input, textarea, select').length,
        sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      })`);
      notes.push(`Options page: ${shape}`);
      try {
        const seen = JSON.parse(shape);
        if (!seen.controls) problems.push('options — the page rendered no controls.');
        if (seen.sideways) problems.push('options — the page scrolls horizontally at 1100px wide.');
      } catch { problems.push('options — could not read the page.'); }
    }, collector(optionsLogs));
    if (optionsLogs.length) problems.push(...optionsLogs.map(line => `options — ${line}`));
    else notes.push('Options page loaded clean: no console errors, no CSP violations.');
  }
} catch (error) {
  problems.push(`harness — ${error.message}`);
} finally {
  await browser.close();
}

for (const line of browser.stderr().split('\n')) {
  if (/extension|manifest/i.test(line) && /error|invalid|fail/i.test(line)) problems.push(`chrome — ${line.trim()}`);
}

console.log(notes.join('\n'));
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('\nAll browser checks passed.');
