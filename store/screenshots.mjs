import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { launchBrowser, seedStorage } from '../tools/chrome-harness.mjs';

const dist = process.env.MISE_DIST ?? 'dist';
const port = Number(process.env.MISE_CDP_PORT ?? 9333);
const url = 'https://github.com/microsoft/TypeScript';
const library = {
  schemaVersion: 1,
  prompts: [{ id: 'repository-review', name: 'Review a repository', tags: ['review'], scope: ['https://github.com/*'], variables: [],
    body: 'Review {{owner}}/{{repo}}.\n\n{{> review-only}}\n\nSource: {{url}}' }],
  partials: [{ name: 'review-only', body: 'Explain the architecture and identify actionable improvements.\nDo not modify files.' }],
  siteRules: [{ id: 'github-repository', match: 'https://github.com/*',
    regex: '^https://github\\.com/(?<owner>[^/]+)/(?<repo>[^/?#]+)(?:[/?#].*)?$', flags: '' }],
};
const harness = await launchBrowser(dist, port);
let browser;
try {
  const seeded = await seedStorage(harness.open, library, {
    url, title: 'microsoft/TypeScript', selection: null, sourceTabId: null, source: 'tab', capturedAt: new Date().toISOString(),
  });
  if (seeded !== library.prompts.length) throw new Error(`Cannot seed extension: ${seeded}`);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const tokens = await readFile(`${dist}/tokens.css`, 'utf8');
  await mkdir('store/screenshots', { recursive: true });

  async function stage(surface, caption, popup = false) {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.goto(`chrome-extension://${harness.extensionId}/options.html`);
    await page.locator('#workspace:not([disabled])').waitFor();
    // Replace only the surrounding document; the iframe loads the shipping UI unchanged.
    await page.setContent(`<!doctype html><html><head><style>${tokens}
      * { box-sizing: border-box; } html, body { overflow: hidden; } body { margin: 0; width: 1280px; height: 800px;
      background: var(--ground); color: var(--ink); font-family: var(--font-family); }
      p { position: absolute; margin: 0; color: var(--muted); font-size: 24px; line-height: 1.5;
      left: 60px; top: 28px; }
      iframe { position: absolute; border: 1px solid var(--line); border-radius: 8px;
      background: var(--panel); box-shadow: 0 16px 40px #242e2b18;
      transform-origin: top left;
      ${popup ? 'width: 382px; height: 602px; left: 449px; top: 100px;' : 'width: 1160px; height: 640px; left: 60px; top: 100px;'} }
      </style></head><body><p>${caption}</p><iframe src="${surface}" title="Mise"></iframe></body></html>`);
    const frame = page.frameLocator('iframe');
    return { page, frame };
  }

  // Frame a region rather than shrinking the page to fit. Scaling a tall editor
  // into 640px makes its text unreadable, which is worse on a store listing than
  // showing less of it, so the scale has a floor and the surplus is cropped.
  const MIN_SCALE = 0.82;
  async function frameSurface(surface, region) {
    const dimensions = await surface.frame.locator('body').evaluate(async (body, region) => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.scrollTo(0, 0);
      if (region.popup) return { height: Math.ceil(body.getBoundingClientRect().height), scroll: 0 };
      const from = document.querySelector(region.from);
      const to = document.querySelector(region.to);
      if (!from || !to) throw new Error(`Cannot frame ${region.from} to ${region.to}`);
      // Start on the region's own edge, never a few pixels inside it: an offset
      // that lands mid-control slices a button row along the image boundary.
      const scroll = Math.max(0, Math.floor(from.getBoundingClientRect().top));
      // Stop in the gap after the region, not a few pixels into whatever
      // follows it, which leaves a sliver of the next control on the edge.
      const height = Math.ceil(to.getBoundingClientRect().bottom + (region.pad ?? 12)) - scroll;
      return { height, scroll };
    }, region);
    await surface.page.locator('iframe').evaluate((iframe, dimensions) => {
      const scale = Math.max(0.82, Math.min(1, 640 / dimensions.height));
      // Past the floor the box shows a window onto the region and crops the rest.
      const height = Math.min(dimensions.height + 2, Math.floor(640 / scale));
      iframe.style.height = `${height}px`;
      iframe.style.transform = `scale(${scale})`;
      iframe.style.left = `${(1280 - iframe.offsetWidth * scale) / 2}px`;
      iframe.style.top = `${100 + (640 - height * scale) / 2}px`;
    }, dimensions);
    await surface.frame.locator('body').evaluate((body, scroll) => {
      window.scrollTo(0, scroll);
    }, dimensions.scroll);
    await surface.page.evaluate(() => window.scrollTo(0, 0));
  }

  async function capture(page, name) {
    await page.evaluate(() => document.fonts.ready);
    const bytes = await page.screenshot({ animations: 'disabled' });
    if (bytes.readUInt32BE(16) !== 1280 || bytes.readUInt32BE(20) !== 800) throw new Error('Incorrect screenshot dimensions');
    await writeFile(`store/screenshots/${name}.png`, bytes);
    console.log(`store/screenshots/${name}.png: 1280x800 (${bytes.length} bytes)`);
    await page.close();
  }

  const popup = await stage('palette.html?popup', 'Review the resolved prompt before copying.', true);
  await popup.frame.getByRole('button', { name: 'Review a repository', exact: true }).click();
  await popup.frame.locator('#copy:not([disabled])').waitFor();
  const preview = await popup.frame.locator('#preview').innerText();
  if (!preview.includes('microsoft/TypeScript') || preview.includes('{{')) throw new Error(`Unresolved popup: ${preview}`);
  await frameSurface(popup, { popup: true });
  await capture(popup.page, 'popup');

  const editor = await stage('options.html', 'Edit reusable text and see its live template preview.');
  await editor.frame.getByRole('button', { name: 'Review a repository', exact: true }).click();
  await editor.frame.getByRole('region', { name: 'Library editing' }).waitFor();
  const live = await editor.frame.getByLabel('Live template preview').innerText();
  if (!live.includes('Explain the architecture')) throw new Error('Live preview did not expand the partial');
  await frameSurface(editor, { from: '#editor', to: '[aria-label="Live template preview"]' });
  await capture(editor.page, 'prompt-editor');

  const rule = await stage('options.html', 'Test a site rule to extract values from a URL.');
  await rule.frame.getByRole('button', { name: 'Site rules', exact: true }).click();
  await rule.frame.getByLabel('Test URL (never navigates)').fill(url);
  await rule.frame.getByRole('button', { name: 'Test URL', exact: true }).click();
  await rule.frame.getByText('owner = microsoft\nrepo = TypeScript', { exact: true }).waitFor();
  await frameSurface(rule, { from: '.library-layout', to: 'pre[aria-live]' });
  await capture(rule.page, 'site-rule');
} catch (error) {
  console.error(`Screenshots failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  try { await browser?.close(); }
  finally { await harness.close(); }
}
