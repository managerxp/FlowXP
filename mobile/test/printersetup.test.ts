/* Printers on the phone: the saved list, which printer does which job, the address checks, the byte chunks, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRINTER_TEXTS, chunks, cleanPrinters, colsFor, hostProblem, isMac, linkProblem, portProblem, printerFor, printerLine, removePrinter, setJob, setPaper, upsertPrinter, type SavedPrinter } from '../src/lib/printerSetup.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

const bt = (id: string, address = '00:11:22:33:44:55', jobs: SavedPrinter['jobs'] = []): SavedPrinter => ({ id, name: `Printer ${id}`, kind: 'bluetooth', address, port: 9100, paper: '58', jobs });
const net = (id: string, address = '192.168.1.50', jobs: SavedPrinter['jobs'] = []): SavedPrinter => ({ id, name: `Net ${id}`, kind: 'network', address, port: 9100, paper: '80', jobs });

test('addresses: a Bluetooth address is six pairs; a network address is an IP (each part up to 255) or a name; the port is 1 to 65535', () => {
  assert.equal(isMac('00:11:22:AA:bb:55'), true); assert.equal(isMac('00:11:22:33:44'), false); assert.equal(isMac('00-11-22-33-44-55'), false);
  assert.equal(hostProblem('192.168.1.50'), ''); assert.equal(hostProblem('kitchen-printer.local'), ''); assert.notEqual(hostProblem(''), ''); assert.notEqual(hostProblem('192.168.1.300'), ''); assert.notEqual(hostProblem('192.168.1'), ''); assert.notEqual(hostProblem('not a host'), '');
  assert.equal(portProblem('9100'), ''); assert.notEqual(portProblem('0'), ''); assert.notEqual(portProblem('70000'), ''); assert.notEqual(portProblem('91.5'), ''); assert.notEqual(portProblem('x'), '');
});

test('the saved list is cleaned: broken entries dropped, a job kept by one printer only, defaults filled, capped at six', () => {
  const cleaned = cleanPrinters([bt('a', '00:11:22:33:44:55', ['receipt']), bt('b', 'AA:BB:CC:DD:EE:FF', ['receipt', 'kot', 'kot']), { id: 'x', kind: 'bluetooth', address: 'nope' }, { kind: 'network' }, null, { ...net('n'), port: 'junk', paper: '99' }]);
  assert.deepEqual(cleaned.map((p) => p.id), ['a', 'b', 'n']); assert.deepEqual(cleaned[1].jobs, ['kot'], 'the receipt stays with the first'); assert.equal(cleaned[2].port, 9100); assert.equal(cleaned[2].paper, '58');
  assert.deepEqual(cleanPrinters('junk'), []); assert.equal(cleanPrinters(Array.from({ length: 9 }, (_, i) => bt(`p${i}`, `00:11:22:33:44:0${i}`))).length, 6);
});

test('adding: the first printer does the receipts; the same address is updated, not doubled', () => {
  let list = upsertPrinter([], bt('a')); assert.deepEqual(list[0].jobs, ['receipt']);
  list = upsertPrinter(list, net('b')); assert.deepEqual(list.map((p) => p.jobs), [['receipt'], []]);
  list = upsertPrinter(list, { ...bt('zzz'), name: 'Renamed', paper: '80' }); assert.equal(list.length, 2); assert.equal(list[0].id, 'a'); assert.equal(list[0].name, 'Renamed'); assert.equal(list[0].paper, '80'); assert.deepEqual(list[0].jobs, ['receipt'], 'jobs are kept');
  assert.deepEqual(removePrinter(list, 'a').map((p) => p.id), ['b']);
});

test('jobs: giving one to a printer takes it from the other; the kitchen falls back to the receipt printer', () => {
  let list = [bt('a', undefined, ['receipt']), net('b')];
  assert.equal(printerFor(list, 'receipt')?.id, 'a'); assert.equal(printerFor(list, 'kot')?.id, 'a', 'one printer does both when no kitchen printer is set');
  list = setJob(list, 'b', 'kot', true); assert.equal(printerFor(list, 'kot')?.id, 'b'); assert.equal(printerFor(list, 'receipt')?.id, 'a');
  list = setJob(list, 'b', 'receipt', true); assert.equal(printerFor(list, 'receipt')?.id, 'b'); assert.deepEqual(list[0].jobs, []);
  list = setJob(list, 'b', 'kot', false); assert.equal(printerFor(list, 'kot')?.id, 'b', 'falls back to the receipt printer');
  assert.equal(printerFor([], 'receipt'), null); assert.equal(printerFor([bt('a')], 'receipt'), null);
  assert.equal(setPaper(list, 'a', '80')[0].paper, '80');
});

test('chunks, columns and the line shown under a printer', () => {
  const parts = chunks(new Uint8Array(1300), 512); assert.deepEqual(parts.map((p) => p.length), [512, 512, 276]); assert.deepEqual(chunks(new Uint8Array(0)), []);
  assert.equal(colsFor('58'), 32); assert.equal(colsFor('80'), 48);
  assert.equal(printerLine(bt('a', '00:11:22:33:44:55', ['receipt', 'kot'])), '00:11:22:33:44:55 · 58 mm · Customer receipt, Kitchen ticket'); assert.equal(printerLine(net('b')), '192.168.1.50:9100 · 80 mm');
});

test('a failed connection says what to check', () => {
  assert.match(linkProblem('bluetooth', new Error('Bluetooth permission was not given.')), /Allow FlowXP/); assert.match(linkProblem('bluetooth', new Error('Bluetooth is not enabled.')), /Switch Bluetooth on/);
  assert.match(linkProblem('bluetooth', new Error('x')), /paired/); assert.match(linkProblem('network', new Error('timeout')), /same Wi-Fi/);
});

test('every text of the Printers screens is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(PRINTER_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
