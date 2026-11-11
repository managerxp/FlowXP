import { kvGet, kvSet } from './local.ts';
import { validLogo, type LogoBits } from './escpos.ts';

/* The logo at the top of a thermal receipt. The website turns the uploaded logo into black and white dots and keeps them in the receipt settings; the phone keeps a copy so
   printing works with no internet and never waits for the network. Nothing here can stop a receipt: any trouble means the receipt prints without the logo. */
const KEY = 'print_logo';
const STAMP = 'print_logo_at';
const FRESH_MS = 24 * 60 * 60 * 1000;   // a changed logo reaches the phone within a day, or at once on the first print
let refreshing = false;

/** The dots to print from a business's receipt settings, or null when there is no logo, it is switched off, or the dots are not valid. */
export const logoFrom = (receiptSettings: Record<string, unknown> | undefined | null): LogoBits | null => {
  if (!receiptSettings || receiptSettings.show_logo === false) return null;
  const bits = receiptSettings.logo_bits;
  return validLogo(bits) ? bits : null;
};

const refresh = async (api: { get: <T>(path: string) => Promise<T> }): Promise<LogoBits | null> => {
  const rec = await api.get<{ receipt_settings?: Record<string, unknown> }>('/businesses/current');
  const logo = logoFrom(rec.receipt_settings);
  await kvSet(KEY, JSON.stringify(logo)).catch(() => {});
  await kvSet(STAMP, String(Date.now())).catch(() => {});
  return logo;
};

/** The logo to print. The kept copy is used at once; it is refreshed from the server in the background when it is older than a day. With no copy yet, the server is asked (at most 2 seconds). */
export const printLogo = async (api: { get: <T>(path: string) => Promise<T> }): Promise<LogoBits | null> => {
  let kept: LogoBits | null = null; let age = Infinity;
  try {
    const raw = await kvGet(KEY);
    if (raw != null) { const v = JSON.parse(raw); kept = validLogo(v) ? v : null; age = Date.now() - Number((await kvGet(STAMP)) || 0); }
  } catch { /* no usable copy */ }
  if (age < FRESH_MS) return kept;
  if (age !== Infinity) {   // we have an answer (maybe "no logo"); refresh without making the print wait
    if (!refreshing) { refreshing = true; refresh(api).catch(() => {}).finally(() => { refreshing = false; }); }
    return kept;
  }
  try { return await Promise.race([refresh(api), new Promise<never>((_, no) => setTimeout(() => no(new Error('slow')), 2000))]); } catch { return null; }
};
