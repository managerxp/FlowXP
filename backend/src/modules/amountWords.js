/* An amount in words, Indian style (crore, lakh, thousand): 2120.34 becomes "Two Thousand One Hundred Twenty Rupees and Thirty Four Paise Only". */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const below100 = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const below1000 = (n) => [n >= 100 && `${ONES[Math.floor(n / 100)]} Hundred`, n % 100 && below100(n % 100)].filter(Boolean).join(' ');
export const wholeInWords = (n) => {
  if (n === 0) return 'Zero';
  const parts = [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']].map(([v, name]) => { const q = Math.floor(n / v); n %= v; return q ? `${below1000(q)} ${name}` : ''; });
  return [...parts, below1000(n)].filter(Boolean).join(' ');
};
export const rupeesInWords = (amount) => {
  const paise = Math.round(Math.abs(Number(amount) || 0) * 100); const r = Math.floor(paise / 100); const p = paise % 100;
  return `${wholeInWords(r)} Rupees${p ? ` and ${below100(p)} Paise` : ''} Only`;
};
