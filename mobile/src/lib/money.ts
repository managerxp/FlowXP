/* Money is kept in paise (whole numbers) everywhere in the app, like the server. Only the screen turns it into rupees. */

export const toPaise = (rupees: number | string): number => Math.round(Number(rupees) * 100);

/** 123456789 paise -> "₹12,34,567.89" (Indian grouping; written by hand because Intl differs between phones). */
export const rupees = (paise: number): string => {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(Math.round(paise));
  const whole = String(Math.floor(abs / 100));
  const cents = String(abs % 100).padStart(2, '0');
  const head = whole.slice(0, -3);
  const tail = whole.slice(-3);
  const grouped = head ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}` : tail;
  return `${sign}₹${grouped}.${cents}`;
};

/** A quantity without trailing zeros: 2 -> "2", 0.25 -> "0.25". */
export const qty = (n: number): string => String(Math.round(n * 1000) / 1000);
