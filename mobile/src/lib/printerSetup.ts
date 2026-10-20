/*
 * The printers connected to this phone: a Bluetooth thermal printer (paired in the phone's Bluetooth settings, then chosen here) or a Wi-Fi/network
 * one (its address on the shop network). Each has a paper size and the jobs it does: the customer's receipt, the kitchen ticket. Kept on this phone,
 * because a Bluetooth printer is paired to one phone. Pure: the saved list, the job routing, the checks and the byte chunks; the Bluetooth and
 * network calls themselves are in printerLink.ts, which needs the development build of the app.
 */
import type { Paper } from './print.ts';

export type PrinterKind = 'bluetooth' | 'network';
export type Job = 'receipt' | 'kot';
export const JOBS: { id: Job; label: string; hint: string }[] = [
  { id: 'receipt', label: 'Customer receipt', hint: 'The bill the customer takes.' },
  { id: 'kot', label: 'Kitchen ticket', hint: 'What the kitchen makes, printed when an order is sent to it.' }
];
export type SavedPrinter = { id: string; name: string; kind: PrinterKind; address: string; port: number; paper: Paper; jobs: Job[] };

export const DEFAULT_PORT = 9100;
export const MAX_PRINTERS = 6;

/* ── checks ──────────────────────────────────────────────────────────────── */
const MAC = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;
const HOST = /^(\d{1,3}\.){3}\d{1,3}$|^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
export const isMac = (v: string): boolean => MAC.test(v.trim());
/** An IPv4 address like 192.168.1.50 (every part 0 to 255), or a name on the network like kitchen-printer.local. */
export const hostProblem = (v: string): string => {
  const h = v.trim();
  if (!h) return 'Enter the printer\'s address on your network, like 192.168.1.50';
  if (!HOST.test(h)) return 'That address does not look right. It is numbers with dots, like 192.168.1.50';
  if (/^[\d.]+$/.test(h) && !(h.split('.').length === 4 && h.split('.').every((p) => Number(p) <= 255))) return 'That address does not look right. It is numbers with dots, like 192.168.1.50';
  return '';
};
export const portProblem = (v: string): string => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 65535 ? '' : 'The port is a number from 1 to 65535 (most printers use 9100)'; };
export const nameOf = (name: string, fallback: string): string => name.replace(/\s+/g, ' ').trim().slice(0, 40) || fallback;

/* ── the saved list ──────────────────────────────────────────────────────── */
const isPaper = (v: unknown): v is Paper => v === '58' || v === '80';
const isJob = (v: unknown): v is Job => v === 'receipt' || v === 'kot';

/** What was saved, made safe to use: unknown or broken entries are dropped, a job belongs to one printer only (the first), and the list is capped. */
export const cleanPrinters = (raw: unknown): SavedPrinter[] => {
  if (!Array.isArray(raw)) return [];
  const taken = new Set<Job>();
  const out: SavedPrinter[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || (r.kind !== 'bluetooth' && r.kind !== 'network') || typeof r.address !== 'string' || !r.address) continue;
    if (r.kind === 'bluetooth' ? !isMac(r.address) : hostProblem(r.address)) continue;
    const jobs = (Array.isArray(r.jobs) ? r.jobs : []).filter(isJob).filter((j, i, a) => a.indexOf(j) === i && !taken.has(j));
    jobs.forEach((j) => taken.add(j));
    const port = Number(r.port);
    out.push({ id: r.id, name: nameOf(String(r.name ?? ''), r.address), kind: r.kind, address: r.address.trim(), port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT, paper: isPaper(r.paper) ? r.paper : '58', jobs });
    if (out.length >= MAX_PRINTERS) break;
  }
  return out;
};

/** Add a printer, or replace the one with the same id. The first printer added does the receipts. A printer already saved at that address is updated, not doubled. */
export const upsertPrinter = (list: SavedPrinter[], p: SavedPrinter): SavedPrinter[] => {
  const same = list.find((x) => x.id === p.id || (x.kind === p.kind && x.address.toLowerCase() === p.address.toLowerCase() && x.port === p.port));
  const next = same ? list.map((x) => (x === same ? { ...p, id: same.id, jobs: p.jobs.length || list.length === 0 ? p.jobs : same.jobs } : x)) : [...list, p];
  const withJob = next.length && !next.some((x) => x.jobs.includes('receipt')) ? next.map((x, i) => (i === 0 ? { ...x, jobs: [...x.jobs, 'receipt' as Job] } : x)) : next;
  return cleanPrinters(withJob);
};
export const removePrinter = (list: SavedPrinter[], id: string): SavedPrinter[] => list.filter((x) => x.id !== id);
/** Give a job to a printer (taking it from whichever had it), or stop that printer doing it. */
export const setJob = (list: SavedPrinter[], id: string, job: Job, on: boolean): SavedPrinter[] =>
  list.map((x) => (x.id === id ? { ...x, jobs: on ? [...x.jobs.filter((j) => j !== job), job] : x.jobs.filter((j) => j !== job) } : { ...x, jobs: on ? x.jobs.filter((j) => j !== job) : x.jobs }));
export const setPaper = (list: SavedPrinter[], id: string, paper: Paper): SavedPrinter[] => list.map((x) => (x.id === id ? { ...x, paper } : x));
/** The printer that does a job. A kitchen ticket with no kitchen printer goes to the receipt printer, as one printer is all many small shops have. */
export const printerFor = (list: SavedPrinter[], job: Job): SavedPrinter | null => list.find((x) => x.jobs.includes(job)) ?? (job === 'kot' ? list.find((x) => x.jobs.includes('receipt')) ?? null : null);
export const newId = (): string => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** What the Printers screen says under a printer: how it connects and what it does. */
export const printerLine = (p: SavedPrinter): string => [p.kind === 'bluetooth' ? p.address : `${p.address}:${p.port}`, `${p.paper} mm`, p.jobs.map((j) => JOBS.find((x) => x.id === j)?.label ?? j).join(', ')].filter(Boolean).join(' · ');

/** Bluetooth printers take small writes: the job is sent in pieces so a long receipt does not overflow the printer's buffer. */
export const chunks = (bytes: Uint8Array, size = 512): Uint8Array[] => { const out: Uint8Array[] = []; for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, i + size)); return out; };

/** The paper width the server's kitchen ticket is asked for. */
export const colsFor = (paper: Paper): number => (paper === '80' ? 48 : 32);

/** The words behind a failed connection, for a person: what to check. */
export const linkProblem = (kind: PrinterKind, error: unknown): string => {
  const m = error instanceof Error ? error.message : String(error ?? '');
  if (/permission/i.test(m)) return 'Allow FlowXP to use Bluetooth (nearby devices) in the phone settings, then try again.';
  if (kind === 'bluetooth') return /not.*enabled|disabled|turn.*on/i.test(m) ? 'Switch Bluetooth on, then try again.' : 'Could not reach the printer. Check that it is switched on, in range, and paired in the phone\'s Bluetooth settings.';
  return 'Could not reach the printer. Check that it is switched on, on the same Wi-Fi as this phone, and that the address is right.';
};

/** Every fixed text on the Printers screens, so the language tests can check each is translated. */
export const PRINTER_TEXTS: string[] = [
  'Bluetooth and Wi-Fi printers: receipt and kitchen ticket',
  'Printers', 'Connect a Bluetooth or Wi-Fi thermal printer, and choose what each one prints.', 'Printing straight to a printer needs the FlowXP development app. In the Expo Go test copy, use the phone print screen or RawBT in Settings.', 'No printers yet.',
  'Add a Bluetooth printer', 'Add a Wi-Fi printer', 'Paired Bluetooth printers', 'Pair the printer first in the phone\'s Bluetooth settings (the code is usually 0000 or 1234), then come back and pick it here.', 'Look for printers nearby', 'Looking…', 'No Bluetooth printers found. Switch the printer on and pair it in the phone\'s Bluetooth settings.',
  'Printer name', 'Address on the network', 'Port', 'Add this printer', '58 mm paper', '80 mm paper', 'Paper', 'What it prints', 'Customer receipt', 'The bill the customer takes.', 'Kitchen ticket', 'What the kitchen makes, printed when an order is sent to it.',
  'Print a test', 'Test sent. If nothing printed, check the printer is on, in range, and has paper.', 'Remove', 'Remove “{name}”?', 'Cancel', 'Back', 'Saved', 'Could not print.',
  'Enter the printer\'s address on your network, like 192.168.1.50', 'That address does not look right. It is numbers with dots, like 192.168.1.50', 'The port is a number from 1 to 65535 (most printers use 9100)',
  'Allow FlowXP to use Bluetooth (nearby devices) in the phone settings, then try again.', 'Switch Bluetooth on, then try again.', 'Could not reach the printer. Check that it is switched on, in range, and paired in the phone\'s Bluetooth settings.',
  'Could not reach the printer. Check that it is switched on, on the same Wi-Fi as this phone, and that the address is right.', 'You can keep up to {n} printers.',
  'Receipts go straight to a connected printer. If it cannot be reached, the bill goes to the phone print screen so printing is never stuck.', 'Straight to my printers', 'Phone print screen', 'Through RawBT',
  'Kitchen ticket sent to the printer.', 'Could not print the kitchen ticket. The order was still sent to the kitchen.'
];
