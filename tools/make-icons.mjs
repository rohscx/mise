import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync, inflateSync } from 'node:zlib';

const OUTPUT_DIRECTORY = new URL('../dist/icons/', import.meta.url);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const BACKGROUND = [0x19, 0x21, 0x1e, 0xff];
const CONTEXT = [0xb2, 0xc2, 0xb8, 0xff];
const DERIVED = [0x7b, 0xde, 0xc0, 0xff];
const FREE = [0xcb, 0xb0, 0xf0, 0xff];
// Integer-aligned stacked fields echo the three sources in a filled prompt.
const DESIGNS = new Map([16, 32, 48, 128].map(size => [size, {
  radius: Math.round(size * 0.16), inset: Math.round(size * 0.23), stroke: Math.max(2, Math.round(size * 0.1)),
}]));

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function setPixel(row, x, colour) {
  const offset = 1 + x * 4;
  row.set(colour, offset);
}

function isInsideRoundedSquare(x, y, size, radius) {
  const cx = x < radius ? radius - 1 : x >= size - radius ? size - radius : x;
  const cy = y < radius ? radius - 1 : y >= size - radius ? size - radius : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= (radius - 0.5) ** 2;
}

function imageData(size, design) {
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x += 1) {
      if (!isInsideRoundedSquare(x, y, size, design.radius)) continue;
      let colour = BACKGROUND;
      for (const [index, ink] of [CONTEXT, DERIVED, FREE].entries()) {
        const top = design.inset + index * Math.round(size * 0.2);
        const right = size - design.inset - (index === 1 ? design.stroke : 0);
        if (x >= design.inset && x < right && y >= top && y < top + design.stroke) colour = ink;
      }
      setPixel(row, x, colour);
    }
    rows.push(row);
  }
  return Buffer.concat(rows);
}

function png(size, design) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 8-bit RGBA, non-interlaced.
  header[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(imageData(size, design))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function verifyPng(bytes, expectedSize) {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`icon-${expectedSize}.png has an invalid signature`);
  let offset = 8;
  let width;
  let height;
  const imageChunks = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const storedCrc = bytes.readUInt32BE(offset + 8 + length);
    const actualCrc = crc32(bytes.subarray(offset + 4, offset + 8 + length));
    if (storedCrc !== actualCrc) throw new Error(`icon-${expectedSize}.png has a bad ${type} CRC`);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    }
    if (type === 'IDAT') imageChunks.push(data);
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  if (width !== expectedSize || height !== expectedSize) throw new Error(`icon-${expectedSize}.png has incorrect dimensions`);
  const pixels = inflateSync(Buffer.concat(imageChunks));
  if (pixels.length !== expectedSize * (1 + expectedSize * 4)) throw new Error(`icon-${expectedSize}.png has incomplete pixels`);
}

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
await Promise.all([...DESIGNS].map(async ([size, design]) => {
  const bytes = png(size, design);
  verifyPng(bytes, size);
  await writeFile(new URL(`icon-${size}.png`, OUTPUT_DIRECTORY), bytes);
}));
