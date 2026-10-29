import type { Db } from './db.ts';
import { LedgerError } from './ledger.ts';

/* The parts of a business's profile that only matter when something is printed or sent: address, contact, bank, UPI, terms and print choices. */

const TEXT = { addressLine: 'address_line', city: 'city', pincode: 'pincode', phone: 'phone', email: 'email', bankName: 'bank_name', bankAccount: 'bank_account', bankIfsc: 'bank_ifsc', upiId: 'upi_id', terms: 'terms' } as const;
export type ProfileExtras = Partial<Record<keyof typeof TEXT, string>> & { printSettings?: PrintSettings };
export type PrintSettings = { paper?: 'A4' | 'A5' | 'THERMAL'; accent?: string; title?: string; showHsn?: boolean; showBank?: boolean; showTerms?: boolean; showUnit?: boolean };

export const PROFILE_COLUMNS = `address_line, city, pincode, phone, email, bank_name, bank_account, bank_ifsc, upi_id, terms, print_settings`;

/** Set the fields that were sent; an empty string clears one. */
export const saveExtras = async (c: Db, orgId: bigint, b: ProfileExtras): Promise<void> => {
  if (b.pincode && !/^\d{6}$/.test(b.pincode)) throw new LedgerError('bad_pincode', 'a PIN code is six digits');
  if (b.bankIfsc && !/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(b.bankIfsc)) throw new LedgerError('bad_ifsc', 'an IFSC code is four letters, a zero, and six letters or digits');
  if (b.printSettings?.accent && !/^#[0-9a-fA-F]{6}$/.test(b.printSettings.accent)) throw new LedgerError('bad_colour', 'the accent colour must look like #1a56db');
  const sets: string[] = []; const vals: unknown[] = [orgId];
  for (const [key, col] of Object.entries(TEXT)) {
    const v = b[key as keyof typeof TEXT];
    if (v === undefined) continue;
    vals.push(v.trim() === '' ? null : key === 'bankIfsc' ? v.trim().toUpperCase() : v.trim());
    sets.push(`${col} = $${vals.length}`);
  }
  if (b.printSettings) { vals.push(JSON.stringify(b.printSettings)); sets.push(`print_settings = $${vals.length}::jsonb`); }
  if (sets.length) await c.query(`UPDATE organizations SET ${sets.join(', ')} WHERE id = $1`, vals);
};
