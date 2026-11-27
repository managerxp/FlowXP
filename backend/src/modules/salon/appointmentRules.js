/* Two rules the appointment screens, the till and the public booking page share. */
import { computeLineTax } from '../tax.js';
import { withGstDefaults } from '../gstOptions.js';
import { localParts } from './schedule.js';

/* An appointment on a later day cannot be checked in or billed: billing completes it, which hands its time back to be booked again. */
export const isLaterDay = (startAt, tz, now = new Date()) => localParts(new Date(startAt), tz).date > localParts(now, tz).date;
export const notYetMessage = (startAt, tz) => `This appointment is on ${new Date(startAt).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz })}. It can be checked in and billed on that day. If the client is here now, reschedule it to today first.`;

/* What the till will charge for these lines before any discount or offer: GST on top unless prices include it, worked out per line by the till's own
   calculation, then the same cash round-off. ponytail: leaves out cess, which salon services do not carry. */
export const payablePaise = (lines, { gstEnabled, gstSettings, taxInclusive, roundOff }) => {
  const taxOn = Boolean(gstEnabled) && !withGstDefaults(gstSettings).composite;
  const sum = lines.reduce((total, l) => total + computeLineTax({
    quantity: 1, unitPricePaise: Number(l.price_paise), discountPaise: 0, taxRatePercent: Number(l.tax_rate) || 0,
    gstEnabled: taxOn, interState: false, inclusive: Boolean(taxInclusive || l.price_includes_tax)
  }).line_total_paise, 0);
  return roundOff ? Math.round(sum / 100) * 100 : sum;
};

export const tillRules = async (db, businessId, settings) => {
  const b = (await db.query(`SELECT gst_enabled, gst_settings, round_off_enabled, COALESCE(timezone, 'Asia/Kolkata') AS tz FROM businesses WHERE business_id = $1`, [businessId])).rows[0];
  return { gstEnabled: b.gst_enabled, gstSettings: b.gst_settings, roundOff: b.round_off_enabled, taxInclusive: settings.tax_inclusive, tz: b.tz };
};
