import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const DIST = 'dist';
const FIXED_DOS_DATE = 0x0021; // 1980-01-01
const FIXED_DOS_TIME = 0x0000;

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await listFiles(join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`Cannot package non-regular entry: ${relative}`);
  }
  return files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function localHeader(name, data, compressed, checksum) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(FIXED_DOS_TIME, 10);
  header.writeUInt16LE(FIXED_DOS_DATE, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  return header;
}

function centralHeader(name, data, compressed, checksum, offset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(0x0314, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt16LE(FIXED_DOS_TIME, 12);
  header.writeUInt16LE(FIXED_DOS_DATE, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(compressed.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt32LE(0o100644 * 0x10000, 38);
  header.writeUInt32LE(offset, 42);
  return header;
}

async function createArchive(paths) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const path of paths) {
    const name = Buffer.from(path, 'utf8');
    const data = await readFile(join(DIST, path));
    const compressed = deflateRawSync(data, { level: 9 });
    const checksum = crc32(data);
    const local = localHeader(name, data, compressed, checksum);
    const central = centralHeader(name, data, compressed, checksum, offset);
    localParts.push(local, name, compressed);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(paths.length, 8);
  end.writeUInt16LE(paths.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function unpackArchive(archive) {
  const files = new Map();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8);
    const checksum = archive.readUInt32LE(offset + 14);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const size = archive.readUInt32LE(offset + 22);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = archive.toString('utf8', nameStart, nameStart + nameLength);
    if (name.startsWith('/') || name.split('/').includes('..')) throw new Error(`Unsafe archive path: ${name}`);
    const dataStart = nameStart + nameLength + extraLength;
    const compressed = archive.subarray(dataStart, dataStart + compressedSize);
    const data = method === 8 ? inflateRawSync(compressed) : compressed;
    if (data.length !== size || crc32(data) !== checksum) throw new Error(`Archive integrity check failed for ${name}`);
    files.set(name, data);
    offset = dataStart + compressedSize;
  }
  return files;
}

function manifestReferences(manifest) {
  const paths = new Set([
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    ...Object.values(manifest.action?.default_icon ?? {}),
    ...Object.values(manifest.icons ?? {}),
  ]);
  for (const group of manifest.web_accessible_resources ?? []) {
    for (const resource of group.resources ?? []) paths.add(resource);
  }
  paths.delete(undefined);
  return [...paths].sort();
}

async function verifyArchive(archive, expectedPaths) {
  const files = unpackArchive(archive);
  const archivedPaths = [...files.keys()].sort();
  if (JSON.stringify(archivedPaths) !== JSON.stringify(expectedPaths)) throw new Error('Archive contents differ from dist/');
  if (!files.has('manifest.json')) throw new Error('manifest.json is not at the archive root');

  const temporary = await mkdtemp(join(tmpdir(), 'mise-package-'));
  try {
    for (const [path, data] of files) {
      const target = resolve(temporary, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
    }
    const manifest = JSON.parse(await readFile(join(temporary, 'manifest.json'), 'utf8'));
    const references = manifestReferences(manifest);
    for (const reference of references) {
      if (reference.includes('*')) throw new Error(`Manifest reference cannot be verified as a concrete path: ${reference}`);
      const info = await stat(join(temporary, posix.normalize(reference.split(/[?#]/)[0]))).catch(() => undefined);
      if (info?.isFile() !== true) throw new Error(`Manifest references missing path: ${reference}`);
    }
    return references.length;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const output = `mise-${packageJson.version}.zip`;
const distInfo = await stat(DIST).catch(() => null);
if (!distInfo?.isDirectory()) throw new Error('dist/ is missing. Run npm run build before packaging.');
const paths = await listFiles(DIST);
const oldestOutput = Math.min(...await Promise.all(paths.map(async path => (await stat(join(DIST, path))).mtimeMs)));
const inputs = [...(await listFiles('src')).map(path => `src/${path}`), 'manifest.json', 'package.json', 'build.mjs', 'tools/make-icons.mjs', 'LICENSE', 'NOTICE'];
for (const input of inputs) {
  if ((await stat(input)).mtimeMs > oldestOutput) throw new Error(`dist/ is stale relative to ${input}. Run npm run build before packaging.`);
}
const first = await createArchive(paths);
const second = await createArchive(paths);
if (!first.equals(second)) throw new Error('Deterministic archive check failed');
const referenceCount = await verifyArchive(first, paths);
await writeFile(output, first);
const digest = createHash('sha256').update(first).digest('hex');

console.log(`Created ${output} (${first.length.toLocaleString('en-US')} bytes)`);
console.log(`Contents: ${paths.length} files from dist/, with manifest.json at the root`);
console.log(`Manifest verification: ${referenceCount} referenced paths exist`);
console.log(`Determinism check: byte-identical (SHA-256 ${digest})`);
