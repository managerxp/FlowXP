/* Shared by the auto parts screens: money in paise from the server, labels for the fixed lists, and the loaders the other industry screens use. */
import { formatCurrency } from './api.js';

export { qs, useDebounced, useLoad } from './salon.js';

export const rsPaise = (paise) => formatCurrency((paise || 0) / 100);
export const n3 = (v) => (v == null ? '' : String(Math.round(Number(v) * 1000) / 1000));

export const CLASSIFICATIONS = [['OEM', 'OEM (genuine)'], ['AFTERMARKET', 'Aftermarket'], ['REFURBISHED', 'Refurbished'], ['USED', 'Used']];
export const CLASS_LABEL = Object.fromEntries(CLASSIFICATIONS);
export const VEHICLE_TYPES = [['CAR', 'Car'], ['BIKE', 'Bike'], ['SCOOTER', 'Scooter'], ['TRUCK', 'Truck'], ['BUS', 'Bus'], ['COMMERCIAL', 'Commercial'], ['OTHER', 'Other']];
export const VEHICLE_LABEL = Object.fromEntries(VEHICLE_TYPES);
export const NUMBER_KINDS = [['OEM', 'OEM number'], ['MFR', 'Manufacturer number'], ['ALTERNATE', 'Alternate number'], ['SUPPLIER', 'Supplier code'], ['REPLACES', 'Replaces (old number)']];
export const KIND_LABEL = Object.fromEntries(NUMBER_KINDS);

/* Fitment is never assumed: a part either has a record for the vehicle, or "unknown". */
export const FIT = {
  VERIFIED: { label: 'Fits (verified)', tone: 'success' },
  UNVERIFIED: { label: 'Fitment not verified', tone: 'warning' },
  NOT_FIT: { label: 'Does not fit', tone: 'danger' },
  UNKNOWN: { label: 'No fitment on record', tone: 'neutral' }
};

export const RETURN_REASONS = [['WRONG_PART', 'Wrong part'], ['DEFECTIVE', 'Defective'], ['NOT_REQUIRED', 'Not required'], ['TRANSIT_DAMAGE', 'Damaged in transit'], ['FITMENT', 'Does not fit'], ['WARRANTY', 'Warranty'], ['OTHER', 'Other']];
export const DISPOSITIONS = [['RESTOCK', 'Back on the shelf'], ['DAMAGED', 'Damaged (not sellable)'], ['SUPPLIER', 'Send to supplier'], ['SCRAP', 'Scrap']];
export const CUSTOMER_CLASSES = [['RETAIL', 'Retail'], ['WORKSHOP', 'Workshop'], ['GARAGE', 'Garage'], ['FLEET', 'Fleet'], ['WHOLESALE', 'Wholesale']];
export const MOVER_TONE = { FAST: 'success', MEDIUM: 'neutral', SLOW: 'warning', DEAD: 'danger' };
