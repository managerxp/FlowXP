/* The business's UPI ID, the one customers pay to by scanning the QR on the payment screen. Same rule as the server (backend/src/utils/validate.js, checkUpiVpa):
   "name@bank", format only. The server cannot confirm it exists either, so the person is told to check it by paying a rupee to themselves. */

/** An empty string is allowed (it clears the UPI ID); otherwise the text to show the person, or null when it is fine. */
export const upiProblem = (value: string): string | null => {
  const v = value.trim();
  if (v === '') return null;
  return /^[\w.-]{2,256}@[a-zA-Z][\w.-]{1,64}$/.test(v) ? null : 'Enter a valid UPI ID, like shopname@okhdfcbank';
};

/** What is saved: trimmed, and without spaces typed by mistake inside it. */
export const cleanUpi = (value: string): string => value.replace(/\s+/g, '');

/** Shown on the settings screen: the ID, or a plain "not set". */
export const upiLabel = (vpa: string | null | undefined): string => (vpa && vpa.trim() ? vpa.trim() : '');
