/* The print agent as a .zip for the "Download the print agent" button: a plain "stored" zip written by hand, so no zip library is needed. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../print-agent');
const FILES = ['agent.js', 'package.json', 'winprint.ps1', 'comprint.ps1', 'install-windows.ps1', 'install-windows.cmd', 'README.md'];

const TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

export const zipOf = (entries) => {   // entries: [{ name, data: Buffer }]
  const parts = []; const central = []; let offset = 0;
  for (const { name, data } of entries) {
    const n = Buffer.from(name); const crc = crc32(data);
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt32LE(crc, 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(n.length, 26);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(offset, 42);
    parts.push(head, n, data); central.push(cen, n); offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
};

/** The agent folder, with a `.origins` file naming the website the download came from, so the installer allows exactly that site. */
export const agentZip = (origin) => {
  const entries = FILES.filter((f) => fs.existsSync(path.join(DIR, f))).map((f) => ({ name: `flowxp-print-agent/${f}`, data: fs.readFileSync(path.join(DIR, f)) }));
  if (/^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(origin || '')) entries.push({ name: 'flowxp-print-agent/.origins', data: Buffer.from(origin) });
  return zipOf(entries);
};
