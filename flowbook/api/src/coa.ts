import type { Db } from './db.ts';

type Type = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
type Seed = { code: string; name: string; type: Type; key?: string };

/* The general Indian chart of accounts. `key` marks the accounts the posting rules look up by name, so a rule never
   depends on a code the owner may have renumbered. Control accounts (AR, AP, GST, inventory) are system accounts. */
const GENERAL: Seed[] = [
  { code: '1000', name: 'Cash in hand', type: 'ASSET', key: 'CASH' },
  { code: '1010', name: 'Bank', type: 'ASSET', key: 'BANK' },
  { code: '1020', name: 'UPI clearing', type: 'ASSET', key: 'UPI_CLEARING' },
  { code: '1030', name: 'Card clearing', type: 'ASSET', key: 'CARD_CLEARING' },
  { code: '1100', name: 'Accounts receivable', type: 'ASSET', key: 'AR' },
  { code: '1200', name: 'Inventory', type: 'ASSET', key: 'INVENTORY' },
  { code: '1300', name: 'Input CGST', type: 'ASSET', key: 'INPUT_CGST' },
  { code: '1301', name: 'Input SGST', type: 'ASSET', key: 'INPUT_SGST' },
  { code: '1302', name: 'Input IGST', type: 'ASSET', key: 'INPUT_IGST' },
  { code: '1310', name: 'TDS receivable', type: 'ASSET', key: 'TDS_RECEIVABLE' },
  { code: '1400', name: 'Prepaid expenses', type: 'ASSET' },
  { code: '1500', name: 'Fixed assets', type: 'ASSET' },
  { code: '1590', name: 'Accumulated depreciation', type: 'ASSET' },
  { code: '1900', name: 'Suspense', type: 'ASSET', key: 'SUSPENSE' },
  { code: '2000', name: 'Accounts payable', type: 'LIABILITY', key: 'AP' },
  { code: '2100', name: 'Output CGST', type: 'LIABILITY', key: 'OUTPUT_CGST' },
  { code: '2101', name: 'Output SGST', type: 'LIABILITY', key: 'OUTPUT_SGST' },
  { code: '2102', name: 'Output IGST', type: 'LIABILITY', key: 'OUTPUT_IGST' },
  { code: '2200', name: 'Customer advances', type: 'LIABILITY', key: 'CUSTOMER_ADVANCES' },
  { code: '2300', name: 'Accrued expenses', type: 'LIABILITY' },
  { code: '2400', name: 'TDS payable', type: 'LIABILITY', key: 'TDS_PAYABLE' },
  { code: '2410', name: 'TCS payable', type: 'LIABILITY', key: 'TCS_PAYABLE' },
  { code: '3000', name: "Owner's capital", type: 'EQUITY' },
  { code: '3100', name: 'Retained earnings', type: 'EQUITY', key: 'RETAINED_EARNINGS' },
  { code: '3200', name: "Owner's drawings", type: 'EQUITY' },
  { code: '3900', name: 'Opening balances', type: 'EQUITY', key: 'OPENING_BALANCE' },
  { code: '4000', name: 'Sales', type: 'INCOME', key: 'SALES' },
  { code: '4100', name: 'Sales returns', type: 'INCOME', key: 'SALES_RETURNS' },
  { code: '4150', name: 'Discount given', type: 'INCOME', key: 'DISCOUNT_GIVEN' },
  { code: '4200', name: 'Other income', type: 'INCOME' },
  { code: '4300', name: 'Exchange gain', type: 'INCOME' },
  { code: '5000', name: 'Cost of goods sold', type: 'EXPENSE', key: 'COGS' },
  { code: '5100', name: 'Purchases', type: 'EXPENSE', key: 'PURCHASES' },
  { code: '5150', name: 'Purchase returns', type: 'EXPENSE', key: 'PURCHASE_RETURNS' },
  { code: '5200', name: 'Salaries and wages', type: 'EXPENSE' },
  { code: '5210', name: 'Rent', type: 'EXPENSE' },
  { code: '5300', name: 'Bank charges', type: 'EXPENSE', key: 'BANK_CHARGES' },
  { code: '5400', name: 'Depreciation', type: 'EXPENSE' },
  { code: '5500', name: 'Round off', type: 'EXPENSE', key: 'ROUND_OFF' },
  { code: '5600', name: 'Bad debts', type: 'EXPENSE' },
  { code: '5700', name: 'Payment gateway fees', type: 'EXPENSE', key: 'GATEWAY_FEES' },
  { code: '5800', name: 'Exchange loss', type: 'EXPENSE' },
  { code: '5900', name: 'Other expenses', type: 'EXPENSE' }
];

/* A few extra accounts per industry, so a cafe sees food cost and a workshop sees labour income from day one. */
const EXTRAS: Record<string, Seed[]> = {
  CAFE: [{ code: '4010', name: 'Food and beverage sales', type: 'INCOME' }, { code: '5010', name: 'Food cost', type: 'EXPENSE' }, { code: '5020', name: 'Wastage', type: 'EXPENSE' }],
  RETAIL: [{ code: '5020', name: 'Stock shrinkage', type: 'EXPENSE' }],
  GYM: [{ code: '2210', name: 'Deferred membership revenue', type: 'LIABILITY' }, { code: '4010', name: 'Membership income', type: 'INCOME' }],
  AUTO_PARTS: [{ code: '4010', name: 'Labour income', type: 'INCOME' }, { code: '5020', name: 'Stock shrinkage', type: 'EXPENSE' }]
};

export const TEMPLATES = ['GENERAL', ...Object.keys(EXTRAS)];

export const seedChartOfAccounts = async (c: Db, orgId: bigint, template = 'GENERAL'): Promise<number> => {
  const seeds = [...GENERAL, ...(EXTRAS[template] ?? [])];
  for (const s of seeds) {
    await c.query(
      `INSERT INTO accounts (organization_id, code, name, type, normal_balance, system_key, is_system) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [orgId, s.code, s.name, s.type, s.type === 'ASSET' || s.type === 'EXPENSE' ? 'D' : 'C', s.key ?? null, Boolean(s.key)]
    );
  }
  return seeds.length;
};
