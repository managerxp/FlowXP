/*
 * Offline bill numbers (migration 0157). The ordinary series is numbered by the server under a row lock, so two tills online can never share a number.
 * With no connection nobody can ask the server, so each phone has a series of its own: it is handed out here while online, and the number the phone
 * printed is accepted when the sale arrives. A number that cannot be accepted never loses the sale: it takes the ordinary series instead.
 */
const SLIP = /^(M\d{1,3})-(\d{4,7})$/;

/** This phone's series: the same one every time it asks, a new one for a new phone. Run inside a transaction. */
export const offlineSeriesFor = async (client, businessId, deviceUid, userId) => {
  // the same lock the invoice numbering takes, so two new phones asking at once cannot be given one code
  await client.query(`SELECT 1 FROM businesses WHERE business_id = $1 FOR NO KEY UPDATE`, [businessId]);
  let row = (await client.query(`SELECT code, last_number FROM offline_series WHERE business_id = $1 AND device_uid = $2`, [businessId, deviceUid])).rows[0];
  if (!row) {
    const taken = new Set((await client.query(
      `SELECT upper(code) AS c FROM offline_series WHERE business_id = $1
       UNION SELECT upper(invoice_prefix) FROM businesses WHERE business_id = $1
       UNION SELECT upper(invoice_prefix) FROM branches WHERE business_id = $1 AND invoice_prefix IS NOT NULL`, [businessId])).rows.map((r) => r.c));
    let k = 1; while (taken.has(`M${k}`)) k++;
    if (k > 999) return null;
    row = (await client.query(`INSERT INTO offline_series (business_id, device_uid, code, created_by) VALUES ($1,$2,$3,$4) RETURNING code, last_number`, [businessId, deviceUid, `M${k}`, userId])).rows[0];
  }
  return { code: row.code, next: row.last_number + 1 };
};

/** The number printed on an offline bill, if it really is from one of this business's series and not already on a bill; otherwise null. Run inside the billing transaction. */
export const claimOfflineNumber = async (client, businessId, printed) => {
  const m = SLIP.exec(String(printed ?? ''));
  if (!m) return null;
  const series = (await client.query(`SELECT 1 FROM offline_series WHERE business_id = $1 AND code = $2 FOR UPDATE`, [businessId, m[1]])).rows[0];
  if (!series) return null;
  if ((await client.query(`SELECT 1 FROM invoices WHERE business_id = $1 AND invoice_number = $2`, [businessId, m[0]])).rows.length) return null;
  await client.query(`UPDATE offline_series SET last_number = GREATEST(last_number, $3) WHERE business_id = $1 AND code = $2`, [businessId, m[1], Number(m[2])]);
  return m[0];
};
