/* Small helpers shared by every screen. Amounts arrive from the API as decimal strings ("1234.50"); they are shown, never added up as floats for anything that matters. */

export const SITE_URL = import.meta.env.VITE_SITE_URL ?? '';   // the public website: the same domain in production (empty = relative), another port in development
export const BRAND = 'FlowBook';   // the product name lives here (and in index.html) so a rename is one edit

export const inr = (value) => {
  const n = Number(value ?? 0);
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
export const isZero = (value) => !Number(value ?? 0);

export const today = () => new Date().toLocaleDateString('en-CA');   // yyyy-mm-dd in the local zone
export const addDays = (iso, days) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + days); return d.toLocaleDateString('en-CA'); };
export const showDate = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
export const showTime = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/** The Indian financial year (1 April to 31 March) that contains a date. */
export const financialYear = (iso = today()) => {
  const y = Number(iso.slice(0, 4)); const startYear = Number(iso.slice(5, 7)) >= 4 ? y : y - 1;
  return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31`, label: `FY ${startYear}-${String(startYear + 1).slice(2)}` };
};

export const STATES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  10: 'Bihar', 11: 'Sikkim', 12: 'Arunachal Pradesh', 13: 'Nagaland', 14: 'Manipur', 15: 'Mizoram', 16: 'Tripura', 17: 'Meghalaya', 18: 'Assam', 19: 'West Bengal', 20: 'Jharkhand', 21: 'Odisha',
  22: 'Chhattisgarh', 23: 'Madhya Pradesh', 24: 'Gujarat', 26: 'Dadra and Nagar Haveli and Daman and Diu', 27: 'Maharashtra', 29: 'Karnataka', 30: 'Goa', 31: 'Lakshadweep', 32: 'Kerala',
  33: 'Tamil Nadu', 34: 'Puducherry', 35: 'Andaman and Nicobar Islands', 36: 'Telangana', 37: 'Andhra Pradesh', 38: 'Ladakh'
};

/** The kinds of cost a project's bills and expenses are sorted into (the same list the books' API accepts). */
export const COST_TYPES = ['Materials', 'Labour', 'Transport', 'Contractors', 'Equipment', 'Other'];

export const ROLE_HELP = {
  owner: 'Everything, including the team and closing the books', admin: 'Everything except making owners', accountant: 'Books, reports and period locks',
  sales: 'Customers and sales invoices', purchases: 'Vendors and bills', viewer: 'Look only', auditor: 'Look only, including the activity log', site: 'Site supervisor: records stock in, out and between sites, and sees projects; no sales, payments or reports'
};

export const statusTone = (s) => ({ ISSUED: 'brand', POSTED: 'ok', SENT: 'ok', DRAFT: 'muted', VOID: 'bad', FAILED_VALIDATION: 'bad', NEEDS_ATTENTION: 'warn', IGNORED_CUTOVER: 'muted', IGNORED_UNSUPPORTED: 'muted', OPEN: 'ok', SOFT_LOCKED: 'warn', CLOSED: 'bad' })[s] || 'muted';

/** The name split for the two-tone wordmark: "Flow" in ink, "Book" in the logo blue. */
export const wordmark = () => { const m = /^(.*?)([A-Z][a-z]+)$/.exec(BRAND); return m ? [m[1], m[2]] : [BRAND, '']; };

export const uuid = () => crypto.randomUUID();

/** Unit codes the GST portal knows (UQC), with a plain label. Only the code is stored. */
export const UNITS = [['NOS', 'Nos'], ['PCS', 'Pcs'], ['KGS', 'Kg'], ['GMS', 'Gram'], ['TON', 'Tonne'], ['LTR', 'Litre'], ['MLT', 'ml'], ['MTR', 'Metre'], ['CMS', 'cm'], ['FTS', 'Foot'], ['INS', 'Inch'],
  ['SQF', 'Sq. ft'], ['SQM', 'Sq. m'], ['HRS', 'Hour'], ['DAY', 'Day'], ['BOX', 'Box'], ['BAG', 'Bag'], ['BTL', 'Bottle'], ['DOZ', 'Dozen'], ['PRS', 'Pair'], ['SET', 'Set'], ['ROL', 'Roll'], ['OTH', 'Other']];
export const unitLabel = (code) => (UNITS.find(([c]) => c === code) || [, code || ''])[1];

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const below100 = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const below1000 = (n) => [n >= 100 && `${ONES[Math.floor(n / 100)]} Hundred`, n % 100 && below100(n % 100)].filter(Boolean).join(' ');
const indian = (n) => {
  const parts = [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']].map(([size, name]) => { const q = Math.floor(n / size); n %= size; return q && `${indian(q)} ${name}`; });
  return [...parts, n && below1000(n)].filter(Boolean).join(' ');
};
/** "1234.50" to "One Thousand Two Hundred Thirty Four Rupees and Fifty Paise Only" (Indian grouping, from the decimal text so nothing is rounded). */
export const amountInWords = (value) => {
  const [r, p = '0'] = String(value ?? '0').replace(/,/g, '').split('.');
  const rupees = Number(r); const paise = Number(`${p}0`.slice(0, 2));
  if (!Number.isFinite(rupees) || rupees < 0) return '';
  const words = [rupees ? `${indian(rupees)} Rupee${rupees === 1 ? '' : 's'}` : paise ? '' : 'Zero Rupees', paise && `${rupees ? 'and ' : ''}${below100(paise)} Paise`].filter(Boolean).join(' ');
  return `${words} Only`;
};

/** Monthly-filer due dates for GSTR-1 (11th) and GSTR-3B (20th) of the next month, for the months whose date falls in the next `ahead` days. QRMP and notified extensions differ: check the portal. */
export const gstDueDates = (from = today(), ahead = 45) => {
  const start = new Date(`${from}T00:00:00`); const out = [];
  for (let m = -1; m <= 2; m += 1) {
    const period = new Date(start.getFullYear(), start.getMonth() + m, 1);
    const label = period.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    for (const [form, day] of [['GSTR-1', 11], ['GSTR-3B', 20]]) {
      const due = new Date(period.getFullYear(), period.getMonth() + 1, day);
      const days = Math.round((due - start) / 86400000);
      if (days >= 0 && days <= ahead) out.push({ form, label, due: due.toLocaleDateString('en-CA'), days });
    }
  }
  return out.sort((a, b) => a.days - b.days);
};

/* Tax deducted at source (paid to a vendor or deducted by a customer) and tax collected at source (on a sale). Rates are the usual ones as of 2026; check the section's rate for your case. */
export const TDS_SECTIONS = [['194C', 'Contractors (1% individual or HUF, 2% others)', 1], ['194J', 'Professional or technical fees (10%; 2% technical services)', 10], ['194I', 'Rent (10% land and building, 2% machinery)', 10], ['194H', 'Commission or brokerage (2%)', 2], ['194Q', 'Purchase of goods over ₹50 lakh (0.1%)', 0.1], ['194O', 'E-commerce operators (0.1%)', 0.1], ['OTHER', 'Another section', 0]];
export const TCS_SECTIONS = [['206C(1)', 'Scrap, timber, minerals and similar (rates vary)', 1], ['52 CGST', 'E-commerce operators (GST)', 0.5], ['OTHER', 'Another section', 0]];
