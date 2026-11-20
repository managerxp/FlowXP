/* Mobile numbers: one way to compare them, whatever way they were typed. */

/** A phone as its last 10 digits ("+91 98765-43210" -> "9876543210"), or null if it can't be a mobile number. */
export const normalisePhone = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
};

const MOBILE_SQL = `RIGHT(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10)`;

export const findCustomerByPhone = async (db, businessId, phone) => {
  const mobile = normalisePhone(phone);
  if (!mobile) return null;
  return (await db.query(
    `SELECT customer_id, name, phone FROM customers WHERE business_id = $1 AND status = 'ACTIVE' AND ${MOBILE_SQL} = $2 ORDER BY customer_id LIMIT 1`,
    [businessId, mobile]
  )).rows[0] || null;
};
