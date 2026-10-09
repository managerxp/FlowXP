/* node scripts/security/booking.mjs  (development server running; demo salon). One phone number cannot be booked over and over by strangers, even when the
   bookings are cancelled. Switches online booking on for the demo salon for the test and puts it back; the test bookings are deleted. */
import pool from '../../src/config/database.js';
const ok = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('  ok  ' + m); };
const base = 'http://localhost:5100/api/public/salon';
const s = (await pool.query(`SELECT business_id, online_booking_slug, online_booking_enabled FROM salon_settings LIMIT 1`)).rows[0];
const slug = 'drill-' + Date.now().toString(36);
const phone = '9' + String(Date.now()).slice(-9);
try {
  await pool.query(`UPDATE salon_settings SET online_booking_enabled = TRUE, online_booking_slug = $2 WHERE business_id = $1`, [s.business_id, slug]);
  const info = (await (await fetch(`${base}/${slug}`)).json());
  ok(info.success, 'the booking page opens');
  const svcs = info.data.services || info.data.categories?.flatMap((c) => c.services) || [];
  const svc = svcs[0];
  const post = async (hour, p = phone) => {
    const day = new Date(Date.now() + (3 + hour) * 86400000).toISOString().slice(0, 10);
    const r = await fetch(`${base}/${slug}/appointments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Drill Test', phone: p, start_at: `${day}T11:00:00`, services: [{ service_id: svc.service_id }] }) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const results = [];
  for (let i = 0; i < 3; i++) { results.push(await post(i)); await pool.query(`UPDATE salon_appointments SET status = 'CANCELLED' WHERE business_id = $1 AND source = 'ONLINE' AND guest_phone LIKE '%' || $2`, [s.business_id, phone.slice(-10)]); }
  console.log('  first three:', results.map((r) => r.status).join(', '));
  ok(results.every((r) => r.status === 201), 'three bookings for a number are accepted (each cancelled after, so the open-booking limit does not apply)');
  results.push(await post(3));
  const fourth = await post(4);
  console.log('  fourth and fifth:', results[3].status, fourth.status, fourth.json?.message);
  ok([results[3], fourth].some((r) => r.status === 429 && /several bookings today/.test(r.json?.message || '')), 'then the number is refused for the day: "' + (fourth.json?.message || results[3].json?.message) + '"');
  const other = await post(5, '9' + String(Date.now() + 7).slice(-9));
  ok(other.status === 201, 'a different number is not affected');
} finally {
  await pool.query(`DELETE FROM salon_appointments WHERE business_id = $1 AND source = 'ONLINE' AND guest_name = 'Drill Test'`, [s.business_id]).catch(() => {});
  await pool.query(`UPDATE salon_settings SET online_booking_enabled = $2, online_booking_slug = $3 WHERE business_id = $1`, [s.business_id, s.online_booking_enabled, s.online_booking_slug]);
  await pool.end();
}
console.log('All good.');
