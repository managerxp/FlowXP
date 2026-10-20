import { Linking } from 'react-native';
import { kvGet, kvSet } from './local.ts';
import { escposBytes, toBase64, type EscposOptions } from './escpos.ts';
import type { Paper } from './print.ts';

/*
 * A Bluetooth (or USB) thermal receipt printer, printed to with no dialog. FlowXP makes the receipt as ESC/POS bytes (escpos.ts) and hands them to RawBT, a free Android
 * app that holds the connection to the printer. The printer is paired and chosen once inside RawBT; FlowXP only needs RawBT installed. This keeps Bluetooth code out of
 * FlowXP itself: no native library to build, and it works in the test copy opened through Expo Go too.
 *
 * Not yet tried against a real printer: the Settings screen has a test print for that. If RawBT is missing the person is told, and the phone's print screen still works.
 */
export type PrinterMode = 'system' | 'rawbt' | 'direct';

export const RAWBT_STORE = 'market://details?id=ru.a402d.rawbtprinter';
export const RAWBT_WEB = 'https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter';

const MODE = 'printer_mode';

/** How a thermal receipt is printed, kept on this phone: auto-cut after the receipt, copies, blank lines before the cut, and whether the cash drawer opens with each print. */
export type PrinterPrefs = { cut: boolean; copies: number; extraLines: number; drawer: boolean };
export const DEFAULT_PREFS: PrinterPrefs = { cut: true, copies: 1, extraLines: 3, drawer: false };
const PREFS = 'printer_prefs';
export const readPrefs = async (): Promise<PrinterPrefs> => {
  try {
    const raw = JSON.parse((await kvGet(PREFS)) || '{}') as Partial<PrinterPrefs>;
    const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
    return { cut: raw.cut !== false, copies: num(raw.copies, 1, 5, 1), extraLines: num(raw.extraLines, 0, 10, 3), drawer: raw.drawer === true };
  } catch { return DEFAULT_PREFS; }
};
export const savePrefs = async (prefs: PrinterPrefs) => { await kvSet(PREFS, JSON.stringify(prefs)).catch(() => {}); };

export const readMode = async (): Promise<PrinterMode> => { const m = await kvGet(MODE).catch(() => null); return m === 'rawbt' || m === 'direct' ? m : 'system'; };
export const setMode = async (mode: PrinterMode) => { await kvSet(MODE, mode).catch(() => {}); };

/** The link RawBT listens for: the receipt's bytes, base64. */
export const rawbtUrl = (text: string, paper: Paper, options: EscposOptions = {}): string => `rawbt:base64,${toBase64(escposBytes(text, paper, options))}`;

/** Hand a receipt to RawBT. Throws a sentence the person can read when RawBT is not there. */
export const printViaRawBT = async (text: string, paper: Paper, options: EscposOptions = {}) => {
  try { await Linking.openURL(rawbtUrl(text, paper, options)); }
  catch { throw new Error('The RawBT app is not installed on this phone.'); }
};

/** Open RawBT's page in the Play Store. */
export const getRawBT = async () => { try { await Linking.openURL(RAWBT_STORE); } catch { await Linking.openURL(RAWBT_WEB).catch(() => {}); } };
