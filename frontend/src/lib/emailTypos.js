/*
 * "Did you mean gmail.com?": the same check the server makes (backend/src/utils/emailCheck.js suggestDomain), run
 * while the person is still typing, so a mistyped provider is fixed on the form before they press anything. The
 * server repeats the check and also confirms the domain really exists, so this is only a convenience.
 */
const KNOWN = ['gmail.com', 'yahoo.com', 'yahoo.in', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'rediffmail.com', 'proton.me', 'protonmail.com', 'zoho.com'];

const distance = (a, b) => {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
};

/** The corrected address ("priya@gmail.com") when the domain looks like a typo of a well-known provider, else null. */
export const suggestEmail = (value) => {
  const email = String(value || '').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const local = email.slice(0, at); const domain = email.slice(at + 1);
  if (!domain.includes('.') || KNOWN.includes(domain)) return null;
  let best = null;
  for (const known of KNOWN) {
    const dist = distance(domain, known);
    if (dist <= 2 && (!best || dist < best.dist)) best = { known, dist };
  }
  return best && (best.dist === 1 || domain.length >= 8) ? `${local}@${best.known}` : null;
};
