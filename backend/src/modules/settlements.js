/*
 * Aggregator settlement reconciliation (owner's request, 2026-09-29) — the
 * spec's own documented fallback for when real aggregator API access isn't
 * available ("allow settlement statement import"): an owner pastes the
 * statement Zomato/Swiggy/ONDC already gives them, and FlowXP checks it
 * rather than trusting it blindly.
 *
 *   Gross - Commission - Payment charges - Delivery charges - Tax - Other = Expected settlement
 *
 * Two independent checks, both computed only from numbers actually present —
 * nothing here estimates a commission rate or invents a deduction:
 *   1. Does the platform's own statement add up (their arithmetic, not ours)?
 *   2. Does the gross amount they report match what FlowXP actually billed
 *      for that order (only when the order was found at all)?
 */
const THRESHOLD_PAISE = 100; // ₹1 — rounding slack, not a real discrepancy

export const STATUS = {
  MATCHED: 'MATCHED',
  ARITHMETIC_ERROR: 'ARITHMETIC_ERROR',
  VALUE_MISMATCH: 'VALUE_MISMATCH',
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND'
};

/** @param line { gross_amount_paise, commission_paise, payment_charges_paise, delivery_charges_paise, tax_paise, other_deductions_paise, net_settled_paise } */
export const expectedSettlementPaise = (line) =>
  Number(line.gross_amount_paise) - Number(line.commission_paise) - Number(line.payment_charges_paise)
  - Number(line.delivery_charges_paise) - Number(line.tax_paise) - Number(line.other_deductions_paise);

/**
 * @param line a settlement_lines row (paise columns)
 * @param orderTotalPaise the matched FlowXP order's actual total, or null if no match was found
 * @returns { status, expected_settlement_paise, arithmetic_diff_paise, value_diff_paise }
 */
export const reconcile = (line, orderTotalPaise) => {
  const expected = expectedSettlementPaise(line);
  const arithmeticDiff = Number(line.net_settled_paise) - expected;
  if (orderTotalPaise == null) {
    return { status: STATUS.ORDER_NOT_FOUND, expected_settlement_paise: expected, arithmetic_diff_paise: arithmeticDiff, value_diff_paise: null };
  }
  const valueDiff = Number(line.gross_amount_paise) - Number(orderTotalPaise);
  if (Math.abs(arithmeticDiff) > THRESHOLD_PAISE) {
    return { status: STATUS.ARITHMETIC_ERROR, expected_settlement_paise: expected, arithmetic_diff_paise: arithmeticDiff, value_diff_paise: valueDiff };
  }
  if (Math.abs(valueDiff) > THRESHOLD_PAISE) {
    return { status: STATUS.VALUE_MISMATCH, expected_settlement_paise: expected, arithmetic_diff_paise: arithmeticDiff, value_diff_paise: valueDiff };
  }
  return { status: STATUS.MATCHED, expected_settlement_paise: expected, arithmetic_diff_paise: arithmeticDiff, value_diff_paise: valueDiff };
};
