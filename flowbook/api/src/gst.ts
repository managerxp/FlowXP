/* GSTIN: 15 characters, state code (2 digits), PAN (10), entity number, 'Z', and a check character (mod-36). */
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SHAPE = /^(\d{2})([A-Z]{5}\d{4}[A-Z])([1-9A-Z])Z([0-9A-Z])$/;

export const gstinCheckChar = (first14: string): string => {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const p = CHARS.indexOf(first14[i] as string) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36] as string;
};

/** True when the text is a well-formed GSTIN whose check character is right. It does not say the registration exists. */
export const validGstin = (g: string): boolean => SHAPE.test(g) && gstinCheckChar(g.slice(0, 14)) === g[14];
export const stateOfGstin = (g: string): string => g.slice(0, 2);

/** GST state and union-territory codes in use (01 to 38, plus 97 other territory and 99 centre jurisdiction). */
export const validStateCode = (s: string): boolean => /^(0[1-9]|[12]\d|3[0-8]|97|99)$/.test(s);
