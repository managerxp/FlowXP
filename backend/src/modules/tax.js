/*
 * GST, in one place.
 *
 * Every rupee of tax on an invoice or a purchase order runs through
 * computeLineTax(). Two callers computing "18% of the taxable value" slightly
 * differently is how a business ends up with an invoice and a GST report that
 * disagree with each other.
 *
 * The rule that matters: an unregistered business must never have GST on a
 * bill. Charging a tax you are not registered to collect is not a rounding
 * error, it is a compliance problem — so gstEnabled=false forces every tax
 * figure to zero regardless of what the product's tax_rate says, rather than
 * trusting each caller to remember to check first.
 */

/** Round half away from zero, in integer paise. Half a paisa rounds up. */
const roundPaise = (value) => Math.round(value);

/**
 * Tax for one invoice or purchase line.
 *
 * @param quantity        number, e.g. 2.5 (kg)
 * @param unitPricePaise  integer
 * @param discountPaise   integer, subtracted before tax is calculated —
 *                        GST is charged on what the customer actually pays.
 * @param taxRatePercent  e.g. 18 for 18%
 * @param gstEnabled      the business's registration flag
 * @param interState      true splits the tax into IGST; false splits it into
 *                        CGST + SGST. Meaningless, and ignored, when
 *                        gstEnabled is false.
 */
export const computeLineTax = ({
  quantity, unitPricePaise, discountPaise = 0, taxRatePercent = 0, gstEnabled, interState
}) => {
  const grossPaise = roundPaise(quantity * unitPricePaise);
  const taxablePaise = Math.max(0, grossPaise - discountPaise);

  if (!gstEnabled || !taxRatePercent) {
    return {
      taxable_paise: taxablePaise, tax_paise: 0,
      cgst_paise: 0, sgst_paise: 0, igst_paise: 0,
      line_total_paise: taxablePaise
    };
  }

  const taxPaise = roundPaise(taxablePaise * (taxRatePercent / 100));

  if (interState) {
    return {
      taxable_paise: taxablePaise, tax_paise: taxPaise,
      cgst_paise: 0, sgst_paise: 0, igst_paise: taxPaise,
      line_total_paise: taxablePaise + taxPaise
    };
  }

  /* Split down the middle. floor+remainder rather than two independent
     roundings, so an odd paisa of tax lands on one side instead of vanishing
     or being invented — cgst + sgst always equals tax_paise exactly. */
  const cgstPaise = Math.floor(taxPaise / 2);
  const sgstPaise = taxPaise - cgstPaise;

  return {
    taxable_paise: taxablePaise, tax_paise: taxPaise,
    cgst_paise: cgstPaise, sgst_paise: sgstPaise, igst_paise: 0,
    line_total_paise: taxablePaise + taxPaise
  };
};

/** Sum an array of computeLineTax() results into invoice-level totals. */
export const sumLines = (lines) => lines.reduce((acc, l) => ({
  subtotal_paise: acc.subtotal_paise + l.taxable_paise,
  cgst_paise: acc.cgst_paise + l.cgst_paise,
  sgst_paise: acc.sgst_paise + l.sgst_paise,
  igst_paise: acc.igst_paise + l.igst_paise,
  tax_paise: acc.tax_paise + l.tax_paise,
  total_paise: acc.total_paise + l.line_total_paise
}), { subtotal_paise: 0, cgst_paise: 0, sgst_paise: 0, igst_paise: 0, tax_paise: 0, total_paise: 0 });

/** Whether a sale to this customer is inter-state, for CGST/SGST vs IGST. */
export const isInterState = (businessState, customerState) => {
  if (!businessState || !customerState) return false;   // unknown = assume intra-state
  return businessState.trim().toLowerCase() !== customerState.trim().toLowerCase();
};
