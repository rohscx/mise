import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const entryPoints = { sw: 'src/sw.ts', regex: 'src/regex.ts', palette: 'src/ui/palette.ts', options: 'src/ui/options.ts' };
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
if (Object.keys(entryPoints).length) {
  await build({ entryPoints, outdir: 'dist', bundle: true, minify: true,
    charset: 'utf8', target: 'chrome116', format: 'esm' });
}
await Promise.all([
  writeFile('dist/manifest.json', `${JSON.stringify({ ...manifest, version: pkg.version }, null, 2)}\n`),
  copyFile('src/ui/options.html', 'dist/options.html'),
  copyFile('src/ui/options.css', 'dist/options.css'),
  copyFile('src/ui/tokens.css', 'dist/tokens.css'),
  copyFile('src/ui/palette.html', 'dist/palette.html'),
  copyFile('src/ui/palette.css', 'dist/palette.css'),
  copyFile('LICENSE', 'dist/LICENSE'),
  copyFile('NOTICE', 'dist/NOTICE'),
]);
await import('./tools/make-icons.mjs');
for (const file of await readdir('dist', { recursive: true })) {
  const info = await stat(`dist/${file}`);
  if (info.isFile()) console.log(`${file}: ${info.size} bytes`);
}
