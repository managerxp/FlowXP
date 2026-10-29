/* Money is bigint paise everywhere. A JavaScript number never holds an amount (accounting-rules.md I9). */
export type Paise = bigint;

/** Integer division rounded half away from zero (the rounding rule, decision D-07). */
export const roundDiv = (num: bigint, den: bigint): bigint => {
  if (den === 0n) throw new RangeError('division by zero');
  const neg = (num < 0n) !== (den < 0n);
  const n = num < 0n ? -num : num;
  const d = den < 0n ? -den : den;
  const q = (n * 2n + d) / (d * 2n);
  return neg ? -q : q;
};

/** Tax on a taxable value; the rate is in basis points (1800 = 18%, 250 = 2.5%). */
export const taxOn = (taxable: Paise, rateBp: number): Paise => {
  if (!Number.isInteger(rateBp) || rateBp < 0) throw new RangeError('a tax rate is a whole number of basis points');
  return roundDiv(taxable * BigInt(rateBp), 10000n);
};

/** Split an amount into the given shares so the parts always add up to the whole (largest remainder). */
export const allocate = (total: Paise, weights: bigint[]): Paise[] => {
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum <= 0n) throw new RangeError('weights must add up to more than zero');
  const base = weights.map((w) => (total * w) / sum);
  let left = total - base.reduce((a, b) => a + b, 0n);
  const order = weights.map((w, i) => ({ i, rem: (total * w) % sum })).sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  for (const { i } of order) { if (left <= 0n) break; base[i] = (base[i] as bigint) + 1n; left -= 1n; }
  return base;
};

/** "1180.50" to 118050n. Two decimals at most; no floats. */
export const toPaise = (text: string): Paise => {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) throw new RangeError(`not an amount: ${text}`);
  const value = BigInt(m[2] as string) * 100n + BigInt(((m[3] ?? '') + '00').slice(0, 2));
  return m[1] ? -value : value;
};

/** 118050n to "1,180.50" (Indian grouping). */
export const formatINR = (p: Paise): string => {
  const neg = p < 0n;
  const abs = neg ? -p : p;
  const rupees = (abs / 100n).toString();
  const paise = (abs % 100n).toString().padStart(2, '0');
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${neg ? '-' : ''}${grouped}.${paise}`;
};

/** 118050n to "1180.50": the plain decimal the API speaks (no grouping, no float). */
export const paiseToString = (p: Paise): string => {
  const neg = p < 0n;
  const abs = neg ? -p : p;
  return `${neg ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
};
