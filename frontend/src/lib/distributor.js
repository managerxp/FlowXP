/*
 * Shared bits of the distributor screens: the vocabulary (what the API calls things and what a person reads), and the
 * helpers they all use. Money, quantities and loading come from the wholesale library, which is the same code.
 */
export * from './wholesale.js';

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const SALES_ROLES = {
  SALES_MANAGER: 'Sales manager', SALES_EXECUTIVE: 'Sales executive', FIELD_SALES: 'Field sales representative', COLLECTION_EXECUTIVE: 'Collection executive', DELIVERY_EXECUTIVE: 'Delivery executive'
};

export const TERRITORY_LEVELS = { REGION: 'Region', TERRITORY: 'Territory', AREA: 'Area' };
export const CHILD_LEVEL = { REGION: 'TERRITORY', TERRITORY: 'AREA' };

export const SCHEME_KINDS = { BUY_X_GET_Y: 'Buy X, get Y free', QTY_DISCOUNT: 'Quantity discount', VALUE_DISCOUNT: 'Value discount' };
export const SCHEME_STATUS = { ACTIVE: { label: 'Running', tone: 'success' }, UPCOMING: { label: 'Starts soon', tone: 'brand' }, EXPIRED: { label: 'Ended', tone: 'neutral' }, INACTIVE: { label: 'Switched off', tone: 'neutral' } };

export const TARGET_SCOPES = { BUSINESS: 'Whole business', SALESPERSON: 'Salesperson', TERRITORY: 'Territory', BRAND: 'Brand', CATEGORY: 'Category', PRODUCT: 'Product', CUSTOMER: 'Retailer' };
export const PERIODS = { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', YEARLY: 'Yearly (financial year)' };
export const TARGET_STATUS = { ACHIEVED: { label: 'Achieved', tone: 'success' }, ON_TRACK: { label: 'On track', tone: 'success' }, BEHIND: { label: 'Behind', tone: 'warning' }, MISSED: { label: 'Missed', tone: 'danger' }, UPCOMING: { label: 'Not started', tone: 'neutral' } };

export const VISIT_OUTCOMES = { ORDER: 'Order taken', COLLECTION: 'Collected payment', NO_ORDER: 'No order', FOLLOW_UP: 'Follow up', NOT_AVAILABLE: 'Not available', CLOSED: 'Shop closed' };
export const AGREEMENT = { ACTIVE: { label: 'In force', tone: 'success' }, EXPIRING: { label: 'Ends soon', tone: 'warning' }, EXPIRED: { label: 'Ended', tone: 'danger' }, UPCOMING: { label: 'Not started', tone: 'neutral' }, NONE: { label: 'No dates', tone: 'neutral' } };

/** A reference the device invents for a visit, so the visit, its order and its payment can be linked offline. */
export const newRef = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 36);
