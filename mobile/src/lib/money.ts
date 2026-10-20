/* Money is kept in paise (whole numbers) everywhere in the app, like the server. Only the screen turns it into rupees. */

import { getDisplay } from './display.ts';

export const toPaise = (rupees: number | string): number => Math.round(Number(rupees) * 100);

const format = (paise: number, places: 0 | 1 | 2): string => {
  const sign = paise < 0 ? '-' : '';
  const unit = places === 0 ? 100 : places === 1 ? 10 : 1;   // the smallest step shown, in paise
  const abs = Math.round(Math.abs(Math.round(paise)) / unit) * unit;
  const whole = String(Math.floor(abs / 100));
  const cents = places === 0 ? '' : places === 1 ? `.${Math.floor((abs % 100) / 10)}` : `.${String(abs % 100).padStart(2, '0')}`;
  const head = whole.slice(0, -3);
  const tail = whole.slice(-3);
  const grouped = head ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}` : tail;
  return `${sign}₹${grouped}${cents}`;
};

/** 123456789 paise -> "₹12,34,567.89" (Indian grouping; written by hand because Intl differs between phones). The decimal places follow Settings > Display (2 by default): this is for the screen. */
export const rupees = (paise: number): string => format(paise, getDisplay().decimals);
/** Always two decimal places: for what is printed or sent (a receipt, a shared bill), which must show the exact amount whatever the screen shows. */
export const rupeesExact = (paise: number): string => format(paise, 2);

/** A quantity without trailing zeros: 2 -> "2", 0.25 -> "0.25". */
export const qty = (n: number): string => String(Math.round(n * 1000) / 1000);
