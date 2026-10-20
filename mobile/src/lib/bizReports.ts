/*
 * The business reports on the phone (the website's Reports page has the same ones, with CSV and printing): Day Book, Profit & Loss, profit by
 * bill / item / party, discounts, GST by rate / HSN, TCS-TDS-cess, stock, low stock, sales and purchases by party, who owes you, expenses, and a
 * party's statement. Each is read-only, comes from an endpoint the website already uses, and is turned here into the same plain shape (a few
 * figures, then lists), so one screen shows them all. The builders are pure apart from t(), which puts the fixed words in the chosen language
 * (a phrase with a number in it is one text with {n}, so it can be translated whole).
 */
import { t } from './i18n.ts';
import { formatDate } from './display.ts';

export type Row = { left: string; right?: string; sub?: string; /** tapping the row opens this report */ open?: { id: string; params: Record<string, string> } };
export type Stat = { label: string; value: string; note?: string; bad?: boolean };
export type Section = { title?: string; rows: Row[]; empty?: string };
export type View = { stats: Stat[]; sections: Section[]; note?: string };
type Money = (rupees: number) => string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;   // the JSON a report endpoint answers; each builder reads only the fields it names

export type Def = {
  id: string; title: string; text: string; group: string; perm: 'reports' | 'gst' | 'inventory';
  /** false: the report is as of now (stock), so no date range is offered */ dated: boolean;
  path: (range: { from: string; to: string }) => string; build: (d: J, money: Money) => View;
};

const TYPE: Record<string, string> = { SALE: 'Sale', PURCHASE: 'Purchase', PAYMENT_IN: 'Money in', PAYMENT_OUT: 'Money out', EXPENSE: 'Expense', SALE_RETURN: 'Sale return', PURCHASE_RETURN: 'Purchase return' };
const day = (d: unknown) => formatDate(d);
const pct = (n: unknown) => (n == null ? '' : `${n}%`);
const sign = (n: number) => `${n > 0 ? '+' : ''}${n}%`;
const q = (r: { from: string; to: string }) => `from=${r.from}&to=${r.to}`;
const dot = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' · ');

export const DEFS: Def[] = [
  { id: 'daybook', title: 'Day Book', text: 'Every bill, purchase, payment and expense', group: 'Money', perm: 'reports', dated: true,
    path: (r) => `/reports/transactions?${q(r)}`,
    build: (d, m) => ({
      stats: [{ label: 'Sales', value: m(d.summary.sales) }, { label: 'Purchases', value: m(d.summary.purchases) }, { label: 'Money in', value: m(d.summary.money_in) }, { label: 'Money out', value: m(d.summary.money_out) }],
      sections: [{ rows: d.rows.map((x: J): Row => ({ left: dot(t(TYPE[x.type] ?? x.type), x.number), right: m(x.total), sub: dot(day(x.date), x.party, x.status === 'CANCELLED' && t('Cancelled'), x.balance > 0 && t('Due {amount}', { amount: m(x.balance) })) })), empty: 'Nothing happened in this period.' }],
      note: d.truncated ? 'Only the latest are shown. Choose a shorter period to see the rest.' : undefined
    }) },
  { id: 'pnl', title: 'Profit & Loss', text: 'What is left after cost and expenses', group: 'Money', perm: 'reports', dated: true,
    path: (r) => `/reports/profit-loss?${q(r)}`,
    build: (d, m) => ({
      stats: [{ label: 'Net sales', value: m(d.net_sales) }, { label: 'Gross profit', value: m(d.gross_profit), note: pct(d.gross_margin_pct) }, { label: 'Net profit', value: m(d.net_profit), note: pct(d.net_margin_pct), bad: d.net_profit < 0 }],
      sections: [
        { title: 'Sales', rows: [{ left: 'Gross sales', right: m(d.gross_sales) }, { left: 'Discounts', right: `−${m(d.discounts)}` }, { left: 'Returns', right: `−${m(d.returns)}` }, { left: 'Net sales', right: m(d.net_sales) }, { left: 'Cost of goods', right: `−${m(d.cost_of_goods)}` }, { left: 'Gross profit', right: m(d.gross_profit) }] },
        { title: 'Expenses', rows: d.expenses.map((e: J): Row => ({ left: e.category, right: m(e.amount) })).concat([{ left: 'Total expenses', right: m(d.total_expenses) }]), empty: 'No expenses in this period.' }
      ],
      note: d.uncosted_bills ? t('{n} bills have items with no cost price, so the profit may be higher than shown.', { n: d.uncosted_bills }) : undefined
    }) },
  ...([['bills', 'Bill-wise profit', 'Profit on every bill'], ['items', 'Item-wise profit', 'Profit on every item sold'], ['parties', 'Party-wise profit', 'Profit by customer']] as const).map(([kind, title, text]): Def => ({
    id: `profit-${kind}`, title, text, group: 'Profit', perm: 'reports', dated: true, path: (r) => `/reports/profit/${kind}?${q(r)}`,
    build: (d, m) => ({
      stats: [{ label: 'Sales', value: m(d.totals.sales) }, { label: 'Cost', value: m(d.totals.cost) }, { label: 'Profit', value: m(d.totals.profit), note: pct(d.totals.margin_pct), bad: d.totals.profit < 0 }],
      sections: [{ rows: d.rows.map((x: J): Row => ({ left: kind === 'bills' ? dot(x.number, x.party) : x.name, right: m(x.profit), sub: dot(kind === 'bills' && day(x.date), kind === 'items' && t('{n} sold', { n: x.quantity }), kind === 'parties' && t('{n} bills', { n: x.bills }), t('Sales {amount}', { amount: m(x.sales) }), pct(x.margin_pct), x.uncosted > 0 && t('Some items have no cost')) })), empty: 'No sales in this period.' }]
    })
  })),
  { id: 'discounts', title: 'Discount report', text: 'Discounts given on bills', group: 'Profit', perm: 'reports', dated: true,
    path: (r) => `/reports/discounts?${q(r)}`,
    build: (d, m) => ({
      stats: [{ label: 'Discount given', value: m(d.totals.discount), note: pct(d.totals.pct) }, { label: 'Bills with a discount', value: String(d.totals.bills) }],
      sections: [{ rows: d.rows.map((x: J): Row => ({ left: dot(x.number, x.party), right: m(x.discount), sub: dot(day(x.date), pct(x.pct), t('Bill {amount}', { amount: m(x.gross) })) })), empty: 'No discounts in this period.' }]
    }) },
  { id: 'gst-rates', title: 'GST by rate', text: 'Tax you charged against tax you paid', group: 'GST', perm: 'gst', dated: true,
    path: (r) => `/reports/gst/rates?${q(r)}`,
    build: (d, m) => ({
      stats: [{ label: 'Output tax', value: m(d.totals.output_tax), note: 'Sales' }, { label: 'Input tax', value: m(d.totals.input_tax), note: 'Purchases' }, { label: 'Net tax to pay', value: m(d.totals.net_tax), bad: d.totals.net_tax < 0 }],
      sections: [{ rows: d.rows.map((x: J): Row => ({ left: `${x.rate}%`, right: m(x.net_tax), sub: dot(t('Sales {amount}', { amount: m(x.sales_taxable) }), t('Output tax {amount}', { amount: m(x.output_tax) }), t('Bought {amount}', { amount: m(x.purchase_taxable) }), t('Input tax {amount}', { amount: m(x.input_tax) })) })), empty: 'No tax in this period.' }]
    }) },
  { id: 'gst-hsn', title: 'Sale summary by HSN', text: 'Tax by HSN code and rate', group: 'GST', perm: 'gst', dated: true,
    path: (r) => `/reports/gst/summary?by=hsn&kind=sales&${q(r)}`,
    build: (d, m) => ({
      stats: [{ label: 'Taxable', value: m(d.totals.taxable) }, { label: 'Total tax', value: m(d.totals.tax) }],
      sections: [{ rows: d.rows.map((x: J): Row => ({ left: x.code || t('No HSN'), right: m(x.total), sub: dot(`${x.rate}%`, t('{n} sold', { n: x.qty }), t('Taxable {amount}', { amount: m(x.taxable) }), t('Tax {amount}', { amount: m(x.tax) })) })), empty: 'Nothing sold in this period.' }]
    }) },
  { id: 'gst-options', title: 'TCS, TDS & cess', text: 'Cess, TCS, TDS, reverse charge, composite tax', group: 'GST', perm: 'gst', dated: true,
    path: (r) => `/reports/gst/options?${q(r)}`,
    build: (d, m) => ({
      stats: [{ label: 'Cess charged', value: m(d.totals.cess) }, { label: 'TCS collected', value: m(d.totals.tcs) }, { label: 'TDS held back by customers', value: m(d.totals.tds) },
        { label: 'Reverse charge bills', value: String(d.totals.reverse_charge_bills), note: m(d.totals.reverse_charge_value) }, { label: 'Composite turnover', value: m(d.totals.composite_turnover) }, { label: t('Composite tax payable ({rate}%)', { rate: d.totals.composite_rate }), value: m(d.totals.composite_tax) }],
      sections: [{ title: 'Bills with these', rows: d.rows.map((x: J): Row => ({ left: dot(x.number, x.party), right: m(x.total), sub: dot(day(x.date), x.cess > 0 && t('Cess {amount}', { amount: m(x.cess) }), x.tcs > 0 && t('TCS {amount}', { amount: m(x.tcs) }), x.tds > 0 && t('TDS {amount}', { amount: m(x.tds) }), x.reverse_charge && t('Reverse charge'), x.bill_of_supply && t('Bill of supply')) })), empty: 'No bills carried cess, TCS, TDS, reverse charge or composite supply in this period.' }]
    }) },
  { id: 'stock-summary', title: 'Stock summary', text: 'Stock and its worth, by category', group: 'Stock', perm: 'inventory', dated: false,
    path: () => '/reports/stock/summary',
    build: (d, m) => ({
      stats: [{ label: 'Stock at cost', value: m(d.totals.cost_value) }, { label: 'Stock at selling price', value: m(d.totals.sell_value) }, { label: 'Items low', value: String(d.totals.low), bad: d.totals.low > 0 }],
      sections: [{ rows: d.rows.map((x: J): Row => ({ left: x.category, right: m(x.cost_value), sub: dot(t('{n} items', { n: x.items }), t('{n} in stock', { n: x.qty }), t('Worth {amount} to sell', { amount: m(x.sell_value) }), x.low > 0 && t('{n} low', { n: x.low })) })), empty: 'No stock is being counted yet.' }]
    }) },
  { id: 'stock-low', title: 'Low stock', text: 'Everything at or under its warning level', group: 'Stock', perm: 'inventory', dated: false,
    path: () => '/reports/stock/low',
    build: (d, m) => ({
      stats: [{ label: 'Items to refill', value: String(d.totals.items) }, { label: 'Out of stock', value: String(d.totals.out_of_stock), bad: d.totals.out_of_stock > 0 }, { label: 'Refill cost', value: m(d.totals.refill_cost) }],
      sections: [{ rows: d.rows.map((x: J): Row => ({ left: x.name, right: t('{n} left', { n: x.qty }), sub: dot(x.out_of_stock ? t('Out of stock') : t('Warning at {n}', { n: x.min_stock }), t('Short by {n}', { n: x.short }), x.supplier, t('Refill {amount}', { amount: m(x.refill_cost) })) })), empty: 'Nothing is running low.' }]
    }) },
  ...([['sales', 'Sales by party', 'What each customer bought'], ['purchases', 'Purchases by party', 'What you bought from each supplier']] as const).map(([kind, title, text]): Def => ({
    id: `${kind}-by-party`, title, text, group: 'Parties', perm: 'reports', dated: true, path: (r) => `/reports/by-party?kind=${kind}&${q(r)}`,
    build: (d, m) => ({
      stats: [{ label: kind === 'sales' ? 'Sales' : 'Purchases', value: m(d.totals.total) }, { label: 'Paid', value: m(d.totals.paid) }, { label: 'Still due', value: m(d.totals.balance), bad: d.totals.balance > 0 }],
      sections: [{ rows: d.rows.map((x: J): Row => ({ left: x.name, right: m(x.total), sub: dot(t(kind === 'sales' ? '{n} bills' : '{n} purchases', { n: x.docs }), x.balance > 0 && t('Due {amount}', { amount: m(x.balance) }), x.last_date && t('Last {date}', { date: day(x.last_date) })), open: x.party_id ? { id: 'statement', params: { kind: kind === 'sales' ? 'customer' : 'supplier', party: String(x.party_id), name: x.name } } : undefined })), empty: 'Nothing in this period.' }]
    })
  })),
  ...([['customers', 'Who owes you', 'Customers with unpaid bills'], ['suppliers', 'What you owe', 'Suppliers you still have to pay']] as const).map(([kind, title, text]): Def => ({
    id: `${kind}-dues`, title, text, group: 'Parties', perm: 'reports', dated: false, path: () => `/reports/parties/all?kind=${kind}`,
    build: (d, m) => ({
      stats: [{ label: kind === 'customers' ? 'To collect' : 'To pay', value: m(d.totals.due), bad: d.totals.due > 0 }, { label: kind === 'customers' ? 'Customers owing' : 'Suppliers owed', value: String(d.totals.owing) }],
      sections: [{ rows: d.rows.filter((x: J) => x.due > 0).map((x: J): Row => ({ left: x.name, right: m(x.due), sub: dot(x.phone, x.over_limit && t('Over the credit limit'), x.last_date && t('Last {date}', { date: day(x.last_date) })), open: { id: 'statement', params: { kind: kind === 'customers' ? 'customer' : 'supplier', party: String(x.party_id), name: x.name } } })), empty: kind === 'customers' ? 'Nobody owes you anything.' : 'You owe nobody anything.' }]
    })
  })),
  { id: 'expense-cats', title: 'Expenses by category', text: 'Where the money went', group: 'Money', perm: 'reports', dated: true,
    path: (r) => `/reports/expense/categories?${q(r)}`,
    build: (d, m) => ({
      stats: [{ label: 'Spent', value: m(d.totals.total), note: d.totals.change_pct == null ? undefined : t('{change} on the period before', { change: sign(d.totals.change_pct) }) }, { label: 'Per day', value: m(d.totals.per_day) }],
      sections: [{ title: 'By category', rows: d.rows.map((x: J): Row => ({ left: x.category, right: m(x.total), sub: dot(t('{n} entries', { n: x.count }), pct(x.share_pct), x.change_pct != null && t('{change} on the period before', { change: sign(x.change_pct) })) })), empty: 'No expenses in this period.' },
        { title: 'How it was paid', rows: d.by_method.map((x: J): Row => ({ left: x.method, right: m(x.amount) })) }]
    }) }
];

/** A party's statement (opened from a party row): what they owe, bill by bill and payment by payment, with a running balance. */
export const statementView = (d: J, m: Money): View => ({
  stats: [{ label: 'Opening balance', value: m(d.opening_balance) }, { label: 'Closing balance', value: m(d.closing_balance), bad: d.closing_balance > 0 }],
  sections: [{ rows: d.lines.map((x: J): Row => ({ left: dot(x.type, x.number), right: m(x.balance), sub: dot(day(x.date), x.debit > 0 && `+${m(x.debit)}`, x.credit > 0 && `−${m(x.credit)}`, x.note) })), empty: 'Nothing in this period.' }]
});

export const defOf = (id: string): Def | undefined => DEFS.find((d) => d.id === id);

/** The reports a person may open, in groups, in a fixed order. `may` says whether they hold a permission. */
export const GROUPS = ['Money', 'Profit', 'GST', 'Stock', 'Parties'];
export const listFor = (may: (perm: string) => boolean): { group: string; defs: Def[] }[] =>
  GROUPS.map((group) => ({ group, defs: DEFS.filter((d) => d.group === group && may(d.perm)) })).filter((g) => g.defs.length > 0);

/* Every fixed text a report shows, so the language tests can check each is translated (the lists above reach t() only at run time). */
export const REPORT_TEXTS: string[] = [
  ...DEFS.flatMap((d) => [d.title, d.text]), ...GROUPS,
  'Sale', 'Purchase', 'Money in', 'Money out', 'Expense', 'Sale return', 'Purchase return', 'Cancelled', 'Due {amount}', '{n} bills', '{n} sold', 'Sales {amount}', 'Some items have no cost', 'Bill {amount}', 'Output tax {amount}', 'Bought {amount}', 'Input tax {amount}',
  'Input tax', 'Net tax to pay', 'Output tax', 'No HSN', 'Taxable {amount}', 'Tax {amount}', 'Cess {amount}', 'TCS {amount}', 'TDS {amount}', 'Reverse charge', 'Bill of supply', '{n} items', '{n} in stock', 'Worth {amount} to sell', '{n} low', '{n} left',
  'Out of stock', 'Warning at {n}', 'Short by {n}', 'Refill {amount}', '{n} purchases', 'Last {date}', 'Over the credit limit', '{change} on the period before', '{n} entries', 'Composite tax payable ({rate}%)',
  '{n} bills have items with no cost price, so the profit may be higher than shown.',
  'Nothing happened in this period.', 'Only the latest are shown. Choose a shorter period to see the rest.', 'No expenses in this period.', 'No sales in this period.', 'No discounts in this period.', 'No tax in this period.', 'Nothing sold in this period.',
  'No bills carried cess, TCS, TDS, reverse charge or composite supply in this period.', 'No stock is being counted yet.', 'Nothing is running low.', 'Nothing in this period.', 'Nobody owes you anything.', 'You owe nobody anything.',
  'Gross sales', 'Discounts', 'Returns', 'Net sales', 'Cost of goods', 'Gross profit', 'Total expenses', 'Net profit', 'Sales', 'Purchases', 'Cost', 'Profit', 'Discount given', 'Bills with a discount', 'Taxable', 'Total tax', 'Cess charged', 'TCS collected',
  'TDS held back by customers', 'Reverse charge bills', 'Composite turnover', 'Bills with these', 'Stock at cost', 'Stock at selling price', 'Items low', 'Items to refill', 'Refill cost', 'Paid', 'Still due', 'To collect', 'To pay', 'Customers owing', 'Suppliers owed',
  'Spent', 'Per day', 'By category', 'How it was paid', 'Opening balance', 'Closing balance', 'Statement', 'More reports', 'This report was not found.', 'You do not have access to any reports.'
];
