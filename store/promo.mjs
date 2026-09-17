import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { launchBrowser } from '../tools/chrome-harness.mjs';

const port = Number(process.env.MISE_CDP_PORT ?? 9333);
// Two sizes with separate compositions, not one scaled. The marquee is 2.5:1;
// the small tile's layout stretched into it would leave a dead right half.
const tiles = [
  {
    name: 'tile-440x280.png', width: 440, height: 280,
    style: `body { padding: 40px; }
      .brand { display: flex; align-items: center; justify-content: space-between; height: 120px; }
      h1 { font-size: 88px; letter-spacing: -5px; }
      .bars { width: 76px; gap: 12px; }
      .bars span { height: 14px; }
      .bars span:nth-child(2) { width: 62px; }
      p { margin: 28px 0 0; font-size: 21px; }`,
    body: `<div class="brand"><h1>Mise</h1><div class="bars" aria-hidden="true"><span></span><span></span><span></span></div></div>
      <p>Reusable prompts. Browser context.</p>`,
  },
  {
    name: 'marquee-1400x560.png', width: 1400, height: 560,
    style: `body { display: flex; align-items: center; justify-content: space-between; padding: 0 104px; }
      h1 { font-size: 168px; letter-spacing: -9px; }
      .bars { width: 300px; gap: 26px; }
      .bars span { height: 34px; }
      .bars span:nth-child(2) { width: 238px; }
      p { margin: 26px 0 0; font-size: 36px; }`,
    body: `<div><h1>Mise</h1><p>Reusable prompts. Browser context.</p></div>
      <div class="bars" aria-hidden="true"><span></span><span></span><span></span></div>`,
  },
];
let harness;
let browser;
try {
  const tokens = await readFile(new URL('../src/ui/tokens.css', import.meta.url), 'utf8');
  harness = await launchBrowser(process.env.MISE_DIST ?? 'dist', port);
  await harness.open('options.html');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  await mkdir(new URL('./promo/', import.meta.url), { recursive: true });
  for (const tile of tiles) {
    const context = await browser.newContext({ viewport: { width: tile.width, height: tile.height },
      deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Mise</title><style>${tokens}
      * { box-sizing: border-box; }
      html, body { margin: 0; width: ${tile.width}px; height: ${tile.height}px; overflow: hidden; }
      body { background: var(--ground); color: var(--ink); font-family: var(--font-family); }
      h1 { margin: 0; font-weight: 750; line-height: 1; }
      p { font-weight: 500; line-height: 1.4; letter-spacing: -0.4px; white-space: nowrap; }
      .bars { display: grid; }
      .bars span { display: block; background: var(--muted); }
      .bars span:nth-child(2) { background: var(--accent); }
      .bars span:nth-child(3) { background: var(--free); }
      ${tile.style}
    </style></head><body>${tile.body}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    const bytes = await page.screenshot({ type: 'png', animations: 'disabled', scale: 'css' });
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (!bytes.subarray(0, 8).equals(signature)
      || bytes.readUInt32BE(16) !== tile.width || bytes.readUInt32BE(20) !== tile.height) {
      throw new Error(`${tile.name} must be a ${tile.width}x${tile.height} PNG`);
    }
    // The store rejects alpha on promotional tiles; colour type 2 is opaque truecolour.
    if (bytes[25] !== 2) throw new Error(`${tile.name} must have no alpha channel`);
    const target = new URL(`./promo/${tile.name}`, import.meta.url);
    await writeFile(target, bytes);
    if (!(await readFile(target)).equals(bytes)) throw new Error(`Written ${tile.name} differs from capture`);
    console.log(`store/promo/${tile.name}: ${tile.width}x${tile.height} (${bytes.length} bytes)`);
    await context.close();
  }
} catch (error) {
  console.error(`Promo failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  try { await browser?.close(); }
  finally { await harness?.close(); }
}
