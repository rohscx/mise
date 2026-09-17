import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { launchBrowser } from '../tools/chrome-harness.mjs';

const port = Number(process.env.MISE_CDP_PORT ?? 9333);
const output = new URL('./promo/tile-440x280.png', import.meta.url);
let harness;
let browser;
try {
  const tokens = await readFile(new URL('../src/ui/tokens.css', import.meta.url), 'utf8');
  harness = await launchBrowser(process.env.MISE_DIST ?? 'dist', port);
  await harness.open('options.html');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = await browser.newContext({ viewport: { width: 440, height: 280 }, deviceScaleFactor: 1,
    colorScheme: 'dark', reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Mise</title><style>${tokens}
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 440px; height: 280px; overflow: hidden; }
    body { background: var(--ground); color: var(--ink); font-family: var(--font-family); padding: 40px; }
    .brand { display: flex; align-items: center; justify-content: space-between; height: 120px; }
    h1 { margin: 0; font-size: 88px; font-weight: 750; line-height: 1; letter-spacing: -5px; }
    .bars { display: grid; gap: 12px; width: 76px; }
    .bars span { display: block; height: 14px; background: var(--muted); }
    .bars span:nth-child(2) { width: 62px; background: var(--accent); }
    .bars span:nth-child(3) { background: var(--free); }
    p { margin: 28px 0 0; font-size: 21px; font-weight: 500; line-height: 1.4; letter-spacing: -0.4px; white-space: nowrap; }
  </style></head><body><div class="brand"><h1>Mise</h1><div class="bars" aria-hidden="true"><span></span><span></span><span></span></div></div>
    <p>Reusable prompts. Browser context.</p></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  const bytes = await page.screenshot({ type: 'png', animations: 'disabled', scale: 'css' });
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!bytes.subarray(0, 8).equals(signature) || bytes.readUInt32BE(16) !== 440 || bytes.readUInt32BE(20) !== 280) {
    throw new Error('Promotional tile must be a 440x280 PNG');
  }
  await mkdir(new URL('./promo/', import.meta.url), { recursive: true });
  await writeFile(output, bytes);
  if (!(await readFile(output)).equals(bytes)) throw new Error('Written promotional tile differs from capture');
  console.log(`store/promo/tile-440x280.png: 440x280 (${bytes.length} bytes)`);
} catch (error) {
  console.error(`Promo failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  try { await browser?.close(); }
  finally { await harness?.close(); }
}
