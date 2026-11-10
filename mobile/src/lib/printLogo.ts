import { kvGet, kvSet } from './local.ts';
import { validLogo, type LogoBits } from './escpos.ts';

/* The logo at the top of a thermal receipt. The website turns the uploaded logo into black and white dots and keeps them in the receipt settings; the phone keeps a copy so
   printing works with no internet. Nothing here can stop a receipt: any trouble means the receipt prints without the logo. */
const KEY = 'print_logo';

/** The dots to print from a business's receipt settings, or null when there is no logo, it is switched off, or the dots are not valid. */
export const logoFrom = (receiptSettings: Record<string, unknown> | undefined | null): LogoBits | null => {
  if (!receiptSettings || receiptSettings.show_logo === false) return null;
  const bits = receiptSettings.logo_bits;
  return validLogo(bits) ? bits : null;
};

/** Ask the server for the current logo (waiting at most 2 seconds), keep it, and return it; offline, return the copy kept last time. */
export const printLogo = async (api: { get: <T>(path: string) => Promise<T> }): Promise<LogoBits | null> => {
  try {
    const rec = await Promise.race([api.get<{ receipt_settings?: Record<string, unknown> }>('/businesses/current'), new Promise<never>((_, no) => setTimeout(() => no(new Error('slow')), 2000))]);
    const logo = logoFrom(rec.receipt_settings);
    await kvSet(KEY, JSON.stringify(logo)).catch(() => {});
    return logo;
  } catch {
    try { const kept = JSON.parse((await kvGet(KEY)) || 'null'); return validLogo(kept) ? kept : null; } catch { return null; }
  }
};
