import type { Paper } from './print.ts';

/* Prints that did not come out. When a receipt, a kitchen ticket or a bill-before-payment cannot reach the printer (and there was no print screen to fall back to), it is kept on
   this phone so the person can print it again from the Printers screen once the printer is back on. Pure: the list and its rules; the saving is in printerLink.ts. */
export type FailedKind = 'receipt' | 'kot' | 'bill';
export type FailedJob = {
  id: string; kind: FailedKind; at: number;
  text?: string; paper?: Paper; qr?: string;   // a receipt is kept as the text that was laid out
  ref?: number;                                 // a kitchen ticket or a bill is made again by the server from this order or ticket number
};
export const MAX_FAILED = 10;
export const KEEP_MS = 24 * 60 * 60 * 1000;

const KINDS: FailedKind[] = ['receipt', 'kot', 'bill'];
/** What was saved, made safe: broken or day-old entries dropped, newest first, at most MAX_FAILED. */
export const cleanJobs = (raw: unknown, now: number): FailedJob[] => {
  if (!Array.isArray(raw)) return [];
  const ok = (raw as Record<string, unknown>[]).filter((r) => r && typeof r.id === 'string' && KINDS.includes(r.kind as FailedKind) && typeof r.at === 'number' && now - r.at < KEEP_MS
    && (r.kind === 'receipt' ? typeof r.text === 'string' && (r.paper === '58' || r.paper === '80') : Number.isInteger(r.ref))) as unknown as FailedJob[];
  return ok.sort((a, b) => b.at - a.at).slice(0, MAX_FAILED).map((j) => (j.kind === 'receipt'
    ? { id: j.id, kind: j.kind, at: j.at, text: j.text, paper: j.paper, ...(typeof j.qr === 'string' ? { qr: j.qr } : {}) }
    : { id: j.id, kind: j.kind, at: j.at, ref: j.ref }));
};
/** Keep a failed print. The same order's ticket or bill is kept once, not once per try. */
export const addJob = (list: FailedJob[], job: FailedJob, now: number): FailedJob[] =>
  cleanJobs([job, ...list.filter((j) => !(job.kind !== 'receipt' && j.kind === job.kind && j.ref === job.ref))], now);
export const removeJob = (list: FailedJob[], id: string): FailedJob[] => list.filter((j) => j.id !== id);
export const KIND_LABEL: Record<FailedKind, string> = { receipt: 'Receipt', kot: 'Kitchen ticket', bill: 'Bill before payment' };
export const newJobId = (now: number): string => `j${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
