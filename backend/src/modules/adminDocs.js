/* Tax and totals for a FlowXP invoice or quotation (all money in paise). Pure, so it is testable. */

/** Indian financial year label for a date: 2026-11-13 -> "2627". */
export const fyLabel = (d = new Date()) => {
  const y = d.getFullYear(); const start = d.getMonth() >= 3 ? y : y - 1;
  return `${String(start).slice(2)}${String(start + 1).slice(2)}`;
};

/** Same state (ignoring case and spacing) means CGST + SGST; different means IGST. A missing state counts as the same, so a quote is never blocked by it. */
export const isIntraState = (seller, buyer) => {
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return !norm(seller) || !norm(buyer) || norm(seller) === norm(buyer);
};

/** Clean the lines the screen sent; throws a plain message for anything unusable. */
export const cleanItems = (raw) => {
  if (!Array.isArray(raw) || !raw.length) throw new Error('Add at least one line');
  if (raw.length > 50) throw new Error('At most 50 lines');
  return raw.map((r, i) => {
    const description = String(r?.description ?? '').trim().slice(0, 200);
    const qty = Number(r?.qty); const rate = Math.round(Number(r?.rate_rupees) * 100); const gst = Number(r?.gst_rate ?? 18);
    if (!description) throw new Error(`Line ${i + 1}: write what it is for`);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 1e6) throw new Error(`Line ${i + 1}: quantity must be more than 0`);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1e11) throw new Error(`Line ${i + 1}: enter the price in rupees`);
    if (![0, 5, 12, 18, 28].includes(gst)) throw new Error(`Line ${i + 1}: GST must be 0, 5, 12, 18 or 28`);
    return { description, hsn: String(r?.hsn ?? '').trim().slice(0, 10) || null, qty, rate_paise: rate, gst_rate: gst };
  });
};

/** Per-line tax and the document totals, rounded to the whole rupee at the end. */
export const compute = (items, intra) => {
  let taxable = 0; let cgst = 0; let sgst = 0; let igst = 0;
  const lines = items.map((it) => {
    const base = Math.round(it.qty * it.rate_paise);
    const tax = Math.round((base * it.gst_rate) / 100);
    taxable += base;
    if (intra) { const c = Math.floor(tax / 2); cgst += c; sgst += tax - c; } else igst += tax;
    return { ...it, taxable_paise: base, tax_paise: tax, total_paise: base + tax };
  });
  const gross = taxable + cgst + sgst + igst;
  const total = Math.round(gross / 100) * 100;
  return { lines, totals: { taxable_paise: taxable, cgst_paise: cgst, sgst_paise: sgst, igst_paise: igst, round_off_paise: total - gross, total_paise: total } };
};
