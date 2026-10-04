/*
 * "Never state a number you did not get from a tool" is only an instruction to the model, so this checks it:
 * every money-sized figure (1,000 and up) in an answer has to be one the tools returned, give or take rounding,
 * or the sum or difference of two of them ("up ₹4,200" is the gap between two periods). Smaller numbers
 * (counts, percentages, dates) are not checked: the model works those out itself all the time.
 * The result is advice for the reader, never a block: a wrong flag costs a note, a miss costs nothing new.
 */
const MULT = { k: 1e3, l: 1e5, lakh: 1e5, lakhs: 1e5, cr: 1e7, crore: 1e7, crores: 1e7 };
const MAX_NUMBERS = 300;

const numbersIn = (value, out) => {
  if (typeof value === 'number' && Number.isFinite(value)) out.add(Math.abs(value));
  else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => numbersIn(v, out));
  return out;
};

/** The money-sized figures an answer states: [{ text, value, rounded }]. */
export const figuresIn = (answer) => {
  const text = String(answer || '').replace(/\d{4}-\d{2}-\d{2}/g, ' ');
  const found = [];
  for (const m of text.matchAll(/(₹|rs\.?\s*)?(\d[\d,]*(?:\.\d+)?)\s*(lakhs?|crores?|cr|k|l)?(?![\w-])/gi)) {
    const base = Number(m[2].replace(/,/g, ''));
    const suffix = m[3] ? m[3].toLowerCase() : null;
    const value = base * (suffix ? MULT[suffix] : 1);
    const isYear = !m[1] && !suffix && !m[2].includes(',') && Number.isInteger(base) && base >= 1900 && base <= 2100;
    if (value >= 1000 && !isYear) found.push({ text: m[0].trim(), value, rounded: Boolean(suffix) });
  }
  return found;
};

/** Figures in the answer that none of the tool results explain. */
export const ungrounded = (answer, results) => {
  const figures = figuresIn(answer);
  if (!figures.length) return [];
  const known = [...numbersIn(results, new Set())].slice(0, MAX_NUMBERS);
  const near = (a, b, tol) => Math.abs(a - b) <= Math.max(tol * Math.max(a, b), 1);
  return figures.filter(({ value, rounded }) => {
    const tol = rounded ? 0.05 : 0.01;
    if (known.some((n) => near(value, n, tol))) return false;
    for (let i = 0; i < known.length; i++) for (let j = i + 1; j < known.length; j++) {
      if (near(value, known[i] + known[j], tol) || near(value, Math.abs(known[i] - known[j]), tol)) return false;
    }
    return true;
  });
};

export const CHECK_NOTE = 'Note: I could not match every ₹ figure above to your data, so please check it on the report screen before acting on it.';
