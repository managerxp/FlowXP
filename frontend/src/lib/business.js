/* Business types that run a kitchen: they get orders, tables, modifiers, recipes. */
export const RESTAURANT_TYPES = ['RESTAURANT', 'CAFE', 'CLOUD_KITCHEN', 'HOTEL', 'GAMING_CAFE', 'RACING'];

/* Hotels (with a restaurant): the hotel module (rooms, bookings, front desk, housekeeping, night audit, reports) on top of the restaurant screens. */
export const HOTEL_TYPES = ['HOTEL'];

/* Gyms: members, memberships, QR cards and phone passes, the front desk and attendance, on top of the general till. */
export const GYM_TYPES = ['GYM'];

/* Gaming lounges (PS5 / console lounges, pool and snooker): the board, timed sessions and rates, on top of the restaurant screens (tables, kitchen, QR menu) used for food and drink. */
export const GAMING_TYPES = ['GAMING_CAFE'];

/* Delivery platforms as their own brands write them. */
export const PLATFORM_LABEL = { ZOMATO: 'Zomato', SWIGGY: 'Swiggy', ONDC: 'ONDC', MAGICPIN: 'Magicpin' };
export const platformName = (code) => PLATFORM_LABEL[code] || (code ? code.charAt(0) + code.slice(1).toLowerCase() : '');

/* Wholesalers and distributors: they get the wholesale module (orders, warehouses, batches, receivables ...). */
export const WHOLESALE_TYPES = ['WHOLESALE', 'DISTRIBUTOR'];
export const isWholesale = (business) => WHOLESALE_TYPES.includes(business?.business_type);

/* Pharmacies: they get the pharmacy module (batch/FEFO product master, direct GRN, inventory, till) instead of
   the generic billing/products/inventory screens. */
export const PHARMACY_TYPES = ['PHARMACY'];

/* The distributor features: a DISTRIBUTOR always has them; a wholesaler has them when the FlowXP team switches them on in the Super Admin. */
export const isDistributor = (business) => isWholesale(business) && Boolean(business?.distributor_enabled);

/* Supermarkets and retail shops: the generic products/billing screens, with generated SKUs, any number of barcodes and an MRP. */
export const RETAIL_TYPES = ['SUPERMARKET', 'RETAIL', 'AUTO_PARTS'];

/* Automotive spare parts: the retail till and stock center, plus the parts catalogue, racks and bins, receiving and counts. */
export const AUTO_PARTS_TYPES = ['AUTO_PARTS'];
