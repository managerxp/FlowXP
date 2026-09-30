/*
 * Rupees in, paise out.
 *
 * The API accepts and returns amounts as decimal rupees ("199.50") because
 * that is what a form field and a JSON consumer expect — nobody wants to type
 * 19950 into a price box. Every table stores integer paise. This file is the
 * one place the conversion happens, so it happens the same way everywhere.
 */

/** "199.5" | 199.5 -> 19950. Throws on anything that is not a finite number. */
export const toPaise = (rupees) => {
  const n = Number(rupees);
  if (!Number.isFinite(n)) throw new Error('Amount must be a number');
  // Round rather than truncate: 19949.999999999996 from float arithmetic
  // upstream must not become one paisa short.
  return Math.round(n * 100);
};

/** 19950 -> 199.5, for API responses. */
export const toRupees = (paise) => Math.round(Number(paise || 0)) / 100;

/** A quantity from the client: must be a positive finite number. */
export const toQuantity = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Quantity must be a positive number');
  return n;
};

/**
 * A non-negative money amount from the client, in rupees. Returns paise, or
 * throws with a field-specific message — the shape every controller here
 * wants for request-body validation.
 */
export const nonNegativePaise = (value, field = 'Amount') => {
  const paise = toPaise(value ?? 0);
  if (paise < 0) throw new Error(`${field} cannot be negative`);
  return paise;
};
