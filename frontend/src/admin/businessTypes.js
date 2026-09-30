/* Shared between AdminFeatures.jsx and AdminAddons.jsx, both of which need the same
   "business type -> a human label" map. Mirrors backend/src/utils/validate.js's BUSINESS_TYPES. */
export const BUSINESS_TYPE_LABEL = {
  RESTAURANT: 'Restaurant', CAFE: 'Café', CLOUD_KITCHEN: 'Cloud kitchen', RETAIL: 'Retail', SUPERMARKET: 'Supermarket',
  PHARMACY: 'Pharmacy', SALON: 'Salon', SERVICES: 'Services', ELECTRONICS: 'Electronics',
  CLOTHING: 'Clothing', GAMING_CAFE: 'Gaming café', RACING: 'Racing', WHOLESALE: 'Wholesale',
  DISTRIBUTOR: 'Distributor', OTHER: 'Other'
};

export const BUSINESS_TYPES = Object.keys(BUSINESS_TYPE_LABEL);
