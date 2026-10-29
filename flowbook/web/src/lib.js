/* Small helpers shared by every screen. Amounts arrive from the API as decimal strings ("1234.50"); they are shown, never added up as floats for anything that matters. */

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

export const ROLE_HELP = {
  owner: 'Everything, including the team and closing the books', admin: 'Everything except making owners', accountant: 'Books, reports and period locks',
  sales: 'Customers and sales invoices', purchases: 'Vendors and bills', viewer: 'Look only', auditor: 'Look only, including the activity log'
};

export const statusTone = (s) => ({ ISSUED: 'brand', POSTED: 'ok', SENT: 'ok', DRAFT: 'muted', VOID: 'bad', FAILED_VALIDATION: 'bad', NEEDS_ATTENTION: 'warn', IGNORED_CUTOVER: 'muted', IGNORED_UNSUPPORTED: 'muted', OPEN: 'ok', SOFT_LOCKED: 'warn', CLOSED: 'bad' })[s] || 'muted';

/** The name split for the two-tone wordmark: "Flow" in ink, "Book" in the logo blue. */
export const wordmark = () => { const m = /^(.*?)([A-Z][a-z]+)$/.exec(BRAND); return m ? [m[1], m[2]] : [BRAND, '']; };

export const uuid = () => crypto.randomUUID();
