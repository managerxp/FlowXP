/*
 * Address reference lookups — today, an India PIN code. Deliberately not
 * behind a business/tenant (withBusiness()): this is the same public postal
 * directory for every business, not anyone's data, so it needs nothing more
 * than a signed-in session. See modules/geo/pincode.js for the dataset.
 */
import { resolvePincode } from '../modules/geo/pincode.js';

/* GET /api/locations/pincode/:code */
export const pincode = (req, res) => {
  const result = resolvePincode(req.params.code);
  if (!result) {
    return res.status(404).json({ success: false, message: 'That PIN code was not found. Enter the address by hand — nothing has been guessed.' });
  }
  res.json({ success: true, data: result });
};
