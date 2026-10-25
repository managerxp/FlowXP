/*
 * The accountant pack on the phone: one ZIP of CSV files for a period (sales and purchase registers, HSN and tax-rate summaries, profit and loss,
 * expenses, every transaction, what is owed each way), saved and handed to the share sheet, or e-mailed to the accountant by the server (their
 * address is remembered for next time). Both need the export permission (owners, admins and accountants have it); the server checks it.
 * The periods here are the ones an accountant asks for: a month, a quarter, a financial year. Pure: periods, requests, checks.
 */
import { authHeaders, type BackupRequest } from './backup.ts';

export type PackPeriod = { id: string; label: string; from: string; to: string };
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();   // m is 1-12

/**
 * The periods offered, relative to `now`: this month so far, last month, this quarter so far, and this and last financial year (the year
 * starts in `fyStartMonth`, 4 = April for most Indian businesses). A period that is not over ends today.
 */
export const packPeriods = (now: Date = new Date(), fyStartMonth = 4): PackPeriod[] => {
  const y = now.getFullYear(); const m = now.getMonth() + 1; const today = iso(y, m, now.getDate());
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const qStart = Math.floor((m - 1) / 3) * 3 + 1;
  const fyStartYear = m >= fyStartMonth ? y : y - 1;
  const fyEnd = (startYear: number) => (fyStartMonth === 1 ? iso(startYear, 12, 31) : iso(startYear + 1, fyStartMonth - 1, lastDay(startYear + 1, fyStartMonth - 1)));
  return [
    { id: 'month', label: 'This month', from: iso(y, m, 1), to: today },
    { id: 'last-month', label: 'Last month', from: iso(prev.y, prev.m, 1), to: iso(prev.y, prev.m, lastDay(prev.y, prev.m)) },
    { id: 'quarter', label: 'This quarter', from: iso(y, qStart, 1), to: today },
    { id: 'fy', label: 'This financial year', from: iso(fyStartYear, fyStartMonth, 1), to: today < fyEnd(fyStartYear) ? today : fyEnd(fyStartYear) },
    { id: 'last-fy', label: 'Last financial year', from: iso(fyStartYear - 1, fyStartMonth, 1), to: fyEnd(fyStartYear - 1) }
  ];
};
/** The server refuses a period longer than about a year (400 days). */
export const SPAN_LIMIT_DAYS = 400;
export const spanDays = (p: { from: string; to: string }): number => Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86400000);

export const packFileName = (p: { from: string; to: string }): string => `accountant-pack-${p.from}-to-${p.to}.zip`;
export const packRequest = (apiUrl: string, session: { token: string | null; businessId: number | null; branchId: number | null }, p: { from: string; to: string }): BackupRequest => ({
  url: `${apiUrl.replace(/\/$/, '')}/api/reports/accountant-pack?from=${p.from}&to=${p.to}`, headers: authHeaders(session), fileName: packFileName(p)
});
export const emailBody = (email: string, p: { from: string; to: string }) => ({ email: email.trim(), from: p.from, to: p.to });
export const emailProblem = (email: string): string => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? '' : 'Enter the accountant\'s email address.');

/** Every fixed text on the screen, so the language tests can check each is translated. */
export const PACK_TEXTS: string[] = [
  'Accountant pack', 'One ZIP of CSV files for the period: sales and purchase registers, HSN and tax-rate summaries, profit and loss, expenses, every transaction, and what is owed each way.', 'Period', 'This month', 'Last month', 'This quarter',
  'This financial year', 'Last financial year', 'Download', 'Preparing…', 'Accountant email', "Enter the accountant's email address.", 'Email', 'Sent: {email}', 'Their address is remembered for next time.', 'Back', 'Could not send. Check the connection and try again.',
  'Choose a period of up to about a year', 'Send on WhatsApp', 'Only owners, admins and accountants can export.'
];
