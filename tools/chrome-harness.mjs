import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function resolveChrome() {
  if (process.env.MISE_CHROME) return process.env.MISE_CHROME;
  // Playwright's Chromium first, deliberately. It is pinned by the lockfile, it
  // still honours --load-extension where current stable Chrome ignores it, and
  // it is not the browser the developer is using: driving an installed Chrome
  // surfaces its crashes as OS dialogs on someone's desktop.
  try {
    const { chromium } = await import('playwright');
    const path = chromium.executablePath();
    if (path) { await access(path); return path; }
  } catch { /* fall back to whatever this machine has */ }
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  try { await access(mac); return mac; } catch { /* not macOS */ }
  for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    const found = spawnSync('which', [name], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  throw new Error('No Chrome found. Run `npx playwright install chromium`, or set MISE_CHROME.');
}

export async function cdp(url, commands, onEvent) {
  const socket = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error(`Could not attach to ${url}`));
  });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) pending.get(message.id)?.(message);
    else onEvent?.(message);
  };
  const send = (method, params = {}) => new Promise(resolve => {
    const next = ++id;
    pending.set(next, resolve);
    socket.send(JSON.stringify({ id: next, method, params }));
  });
  try { return await commands(send); }
  finally { socket.close(); }
}

export const evaluate = (send, expression, awaitPromise = false) =>
  send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
    .then(reply => reply.result?.exceptionDetails
      ? `EXCEPTION: ${reply.result.exceptionDetails.text}`
      : reply.result?.result?.value);

export async function launchBrowser(dist, port = 9333) {
  const DIST = resolve(dist);
  const PORT = port;
  const chromePath = await resolveChrome();
  const profile = await mkdtemp(join(tmpdir(), 'mise-browser-'));
  const chrome = spawn(chromePath, [
    '--headless=new',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`,
    `--load-extension=${DIST}`,
    `--disable-extensions-except=${DIST}`,
    // Chrome 137+ ignores --load-extension unless this opt-out is present; the
    // extension then half-loads with no API access, which looks like a dozen
    // unrelated failures rather than a refusal.
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--no-first-run', '--no-default-browser-check', '--disable-sync',
    '--disable-background-networking', '--disable-component-update',
    ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  chrome.stderr.on('data', chunk => { stderr += chunk.toString(); });
  let launchError;
  chrome.on('error', error => { launchError = error; });
  // Chrome derives an unpacked extension's id from its absolute path, so it can
  // be computed rather than discovered. A service-worker target only exists
  // once something wakes the worker, and newer Chrome leaves it dormant, so
  // waiting for that target reads as "the extension failed to load".
  const absolute = resolve(dist);
  const digest = createHash('sha256').update(absolute, 'utf8').digest('hex').slice(0, 32);
  const extensionId = [...digest].map(c => String.fromCharCode(97 + Number.parseInt(c, 16))).join('');
  const open = async path => {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (launchError || chrome.exitCode !== null || chrome.signalCode !== null) {
        throw new Error(`Chrome exited before opening its debugging port: ${launchError?.message ?? chrome.exitCode ?? chrome.signalCode}\n${stderr}`);
      }
      try {
        return await (await fetch(
          `http://127.0.0.1:${PORT}/json/new?chrome-extension://${extensionId}/${path}`, { method: 'PUT', signal: AbortSignal.timeout(1500) })).json();
      } catch { await sleep(300); }
    }
    throw new Error(`Chrome never opened its debugging port.\n${stderr}`);
  };

  return { open, extensionId, absolute, stderr: () => stderr, close: async () => {
    chrome.kill('SIGTERM');
    await sleep(400);
    chrome.kill('SIGKILL');
    await rm(profile, { recursive: true, force: true });
  } };
}

export async function seedStorage(open, library, slot, page = 'options.html') {
  const state = { revision: 1, generation: 1, syncEnabled: false,
    state: { library, usage: {}, remembered: {}, knownChatHosts: [], strategy: 'capture' } };
  const seeder = await open(page);
  return cdp(seeder.webSocketDebuggerUrl, async send => {
    await send('Runtime.enable');
    await sleep(1200);
    const reachable = await evaluate(send, 'typeof chrome?.storage?.local');
    if (reachable !== 'object') return `extension APIs unreachable (chrome.storage.local is ${reachable})`;
    return evaluate(send, `(async () => {
      await chrome.storage.local.set({ state: ${JSON.stringify(state)} });
      await chrome.storage.session.set({ slot: ${JSON.stringify(slot)} });
      return (await chrome.storage.local.get('state')).state.state.library.prompts.length;
    })()`, true);
  });
}
