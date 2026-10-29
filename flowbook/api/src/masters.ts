import type { Db } from './db.ts';
import { audit } from './audit.ts';
import { UQC, stateOfGstin, validGstin, validStateCode } from './gst.ts';
import { LedgerError } from './ledger.ts';
import { toPaise } from './money.ts';

/** Starter GST slabs so a new organization can bill at once. They are data, not code: check them against the current
    notifications and add a new effective date when a rate changes (research/indian-gst-compliance.md section 4). */
export const seedTaxRates = async (c: Db, orgId: bigint): Promise<void> => {
  for (const [code, name, bp, from] of [['GST0', 'GST 0% / exempt', 0, '2017-07-01'], ['GST5', 'GST 5%', 500, '2017-07-01'], ['GST12', 'GST 12%', 1200, '2017-07-01'], ['GST18', 'GST 18%', 1800, '2017-07-01'], ['GST28', 'GST 28%', 2800, '2017-07-01'], ['GST40', 'GST 40%', 4000, '2025-09-22']] as const) {
    await c.query(`INSERT INTO tax_rates (organization_id, code, name, rate_bp, effective_from) VALUES ($1, $2, $3, $4, $5)`, [orgId, code, name, bp, from]);
  }
};

export const addTaxRate = async (c: Db, orgId: bigint, r: { code: string; name: string; rateBp: number; effectiveFrom: string }, actor: string): Promise<void> => {
  const res = await c.query(`INSERT INTO tax_rates (organization_id, code, name, rate_bp, effective_from) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`, [orgId, r.code, r.name, r.rateBp, r.effectiveFrom]);
  if (res.rowCount === 0) throw new LedgerError('rate_exists', `${r.code} already has a rate from ${r.effectiveFrom}`);
  await audit(c, orgId, { actor, action: 'tax_rate.added', entityType: 'tax_rate', entityId: r.code, detail: { rateBp: r.rateBp, from: r.effectiveFrom } });
};

export type PartyIn = { kind: 'CUSTOMER' | 'VENDOR' | 'BOTH'; name: string; gstin?: string; pan?: string; stateCode?: string; phone?: string; email?: string; creditDays?: number; externalRef?: string;
  addressLine?: string; city?: string; pincode?: string; shipAddressLine?: string; shipCity?: string; shipPincode?: string };

const cleanParty = (p: Partial<PartyIn>) => {
  for (const pin of [p.pincode, p.shipPincode]) if (pin && !/^\d{6}$/.test(pin)) throw new LedgerError('bad_pincode', 'a PIN code is six digits');
  const gstin = p.gstin?.trim().toUpperCase() || null;
  if (gstin && !validGstin(gstin)) throw new LedgerError('bad_gstin', `${gstin} is not a valid GSTIN`);
  const state = p.stateCode ?? (gstin ? stateOfGstin(gstin) : null);
  if (state && !validStateCode(state)) throw new LedgerError('bad_state', `${state} is not a GST state code`);
  if (gstin && state && stateOfGstin(gstin) !== state) throw new LedgerError('state_mismatch', 'the state code does not match the GSTIN');
  return { gstin, state };
};

export const createParty = async (c: Db, orgId: bigint, p: PartyIn, actor: string): Promise<bigint> => {
  const { gstin, state } = cleanParty(p);
  const row = (await c.query(
    `INSERT INTO parties (organization_id, kind, name, gstin, pan, state_code, phone, email, credit_days, external_ref, address_line, city, pincode, ship_address_line, ship_city, ship_pincode) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) ON CONFLICT DO NOTHING RETURNING id`,
    [orgId, p.kind, p.name.trim(), gstin, p.pan ?? null, state, p.phone ?? null, p.email ?? null, p.creditDays ?? 0, p.externalRef ?? null, p.addressLine?.trim() || null, p.city?.trim() || null, p.pincode || null, p.shipAddressLine?.trim() || null, p.shipCity?.trim() || null, p.shipPincode || null])).rows[0];
  if (!row) throw new LedgerError('party_exists', 'a party with that GSTIN or external reference already exists');
  await audit(c, orgId, { actor, action: 'party.created', entityType: 'party', entityId: row.id as bigint, detail: { name: p.name } });
  return row.id as bigint;
};

export const updateParty = async (c: Db, orgId: bigint, id: bigint, p: Partial<PartyIn> & { active?: boolean; whatsappOptOut?: boolean }, actor: string): Promise<boolean> => {
  const cur = (await c.query(`SELECT kind, name, gstin, pan, state_code, phone, email, credit_days FROM parties WHERE id = $1`, [id])).rows[0];
  if (!cur) return false;
  const next: PartyIn = { kind: p.kind ?? cur.kind, name: p.name ?? cur.name, gstin: p.gstin ?? cur.gstin ?? undefined, stateCode: p.stateCode ?? cur.state_code ?? undefined };
  const { gstin, state } = cleanParty({ ...next, pincode: p.pincode, shipPincode: p.shipPincode });
  const text = (v: string | undefined) => (v === undefined ? null : v.trim());   // null keeps what is there; an empty string clears it
  await c.query(
    `UPDATE parties SET address_line = COALESCE($2, address_line), city = COALESCE($3, city), pincode = COALESCE($4, pincode), ship_address_line = COALESCE($5, ship_address_line), ship_city = COALESCE($6, ship_city), ship_pincode = COALESCE($7, ship_pincode) WHERE id = $1`,
    [id, text(p.addressLine), text(p.city), text(p.pincode), text(p.shipAddressLine), text(p.shipCity), text(p.shipPincode)]);
  await c.query(
    `UPDATE parties SET kind = $2, name = $3, gstin = $4, state_code = $5, pan = COALESCE($6, pan), phone = COALESCE($7, phone), email = COALESCE($8, email),
            credit_days = COALESCE($9, credit_days), active = COALESCE($10, active), whatsapp_opt_out = COALESCE($11, whatsapp_opt_out) WHERE id = $1`,
    [id, next.kind, next.name.trim(), gstin, state, p.pan ?? null, p.phone ?? null, p.email ?? null, p.creditDays ?? null, p.active ?? null, p.whatsappOptOut ?? null]);
  await audit(c, orgId, { actor, action: 'party.updated', entityType: 'party', entityId: id });
  return true;
};

export type ItemIn = { sku: string; name: string; kind?: 'GOODS' | 'SERVICE'; hsnSac?: string; taxCode?: string; salePrice?: string; purchasePrice?: string; unit?: string };

export const createItem = async (c: Db, orgId: bigint, i: ItemIn, actor: string): Promise<bigint> => {
  if (i.taxCode) {
    const known = (await c.query(`SELECT 1 FROM tax_rates WHERE code = $1 LIMIT 1`, [i.taxCode])).rowCount;
    if (!known) throw new LedgerError('unknown_tax_code', `no tax code ${i.taxCode}`);
  }
  if (i.unit && !UQC.includes(i.unit)) throw new LedgerError('bad_unit', `${i.unit} is not a unit code the GST portal knows`);
  const row = (await c.query(
    `INSERT INTO items (organization_id, sku, name, kind, hsn_sac, tax_code, sale_price_minor, purchase_price_minor, unit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING RETURNING id`,
    [orgId, i.sku, i.name.trim(), i.kind ?? 'GOODS', i.hsnSac ?? null, i.taxCode ?? null, toPaise(i.salePrice ?? '0'), toPaise(i.purchasePrice ?? '0'), i.unit ?? null])).rows[0];
  if (!row) throw new LedgerError('sku_taken', `SKU ${i.sku} already exists`);
  await audit(c, orgId, { actor, action: 'item.created', entityType: 'item', entityId: row.id as bigint, detail: { sku: i.sku } });
  return row.id as bigint;
};
