import { readFile, readdir, stat } from 'node:fs/promises';

const REQUIRED_PERMISSIONS = ['activeTab', 'clipboardWrite', 'contextMenus', 'scripting', 'storage'];
const OPTIONAL_PERMISSIONS = ['clipboardRead', 'tabs'];
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const same = (actual, expected) => Array.isArray(actual)
  && JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());

async function filesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unexpected non-file in package: ${path}`);
  }
  return files.sort();
}

function section(text, heading) {
  return text.split(`## ${heading}\n`)[1]?.split('\n## ')[0] ?? '';
}

try {
  const listing = await readFile('store/listing.md', 'utf8');
  for (const file of ['manifest.json', 'dist/manifest.json']) {
    const manifest = JSON.parse(await readFile(file, 'utf8'));
    for (const [key, expected, heading] of [
      ['permissions', REQUIRED_PERMISSIONS, 'Required permission justifications'],
      ['optional_permissions', OPTIONAL_PERMISSIONS, 'Optional permission justifications'],
    ]) {
      check(same(manifest[key], expected), `${file}: ${key} must exactly equal ${expected.join(', ')}; update the expected set and listing justifications together.`);
      const block = section(listing, heading);
      const justified = [...block.matchAll(/^### `([^`]+)`\n\n([^#]+)/gm)];
      check(same(justified.map(match => match[1]), manifest[key]), `${file}: ${key} and ${heading} in store/listing.md do not match.`);
      for (const match of justified) check(/without it/i.test(match[2]), `listing.md: ${match[1]} must explain what breaks without it.`);
    }
    check(typeof manifest.description === 'string' && manifest.description.trim().length > 0
      && [...manifest.description].length <= 132, `${file}: description must contain 1–132 characters.`);
    check(!manifest.host_permissions?.length && !manifest.optional_host_permissions?.length
      && !manifest.content_scripts?.length, `${file}: unexpected host permissions or persistent content scripts.`);
    for (const reference of [...Object.values(manifest.icons ?? {}), ...Object.values(manifest.action?.default_icon ?? {})]) {
      check(/^icons\/[^/]+\.png$/.test(reference) && (await stat(`dist/${reference}`).catch(() => null))?.isFile(),
        `${file}: missing icon in dist/icons: ${reference}`);
    }
  }
  const short = section(listing, 'Short description').trim().split('\n\n')[0];
  const count = [...short].length;
  check(count > 0 && count <= 132, `listing.md: short description has ${count} characters; expected 1–132.`);
  check(section(listing, 'Short description').includes(`Character count: **${count}**`), 'listing.md: short description character count is inaccurate.');
  const built = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
  const source = JSON.parse(await readFile('manifest.json', 'utf8'));
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  check(JSON.stringify(built) === JSON.stringify({ ...source, version: pkg.version }), 'dist/manifest.json is stale; run npm run build.');
  for (const name of ['LICENSE', 'NOTICE']) {
    check((await stat(`dist/${name}`).catch(() => null))?.isFile(), `dist/${name} is missing.`);
  }
  for (const file of await filesBelow('dist')) {
    if (!/\.(?:html|js|css)$/.test(file)) continue;
    // Reject remote resource literals conservatively, including escaped URL spellings.
    // Ordinary URL data remains legal; loading contexts and code suffixes do not.
    const text = (await readFile(file, 'utf8')).replace(/\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi,
      (_, unicode, hex) => String.fromCharCode(parseInt(unicode ?? hex, 16))).replace(/\\\//g, '/');
    const remote = '(?:https?:)?//';
    const patterns = [
      new RegExp(`<script\\b[^>]*\\bsrc\\s*=\\s*["']?${remote}`, 'i'),
      new RegExp(`<link\\b[^>]*\\bhref\\s*=\\s*["']?${remote}`, 'i'),
      new RegExp(`(?:\\bfrom\\s*|\\bimport\\s*(?:\\(\\s*)?|\\bimportScripts\\s*\\(\\s*|\\b(?:Shared)?Worker\\s*\\(\\s*|\\.(?:src|href)\\s*=\\s*)["'\x60]${remote}`, 'i'),
      new RegExp(`["'\x60]${remote}[^"'\x60\\s]*\\.(?:m?js|css)(?:[?#][^"'\x60\\s]*)?["'\x60]`, 'i'),
      new RegExp(`@import\\s*(?:url\\(\\s*)?["']?${remote}`, 'i'),
      new RegExp(`setAttribute\\s*\\(\\s*["'](?:src|href)["']\\s*,\\s*["'\x60]${remote}`, 'i'),
    ];
    check(!patterns.some(pattern => pattern.test(text)), `${file}: remote script or stylesheet reference detected; package all executable resources locally.`);
  }
  if (failures.length) throw new Error(failures.join('\n'));
  console.log(`Store audit passed: permissions and justifications, descriptions (${count}/132), icons, local code, LICENSE and NOTICE.`);
} catch (error) {
  console.error(`Store audit failed:\n${error.message}`);
  process.exitCode = 1;
}
