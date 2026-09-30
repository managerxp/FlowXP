/* Business types that run a kitchen: they get orders, tables, modifiers, recipes. */
export const RESTAURANT_TYPES = ['RESTAURANT', 'CAFE', 'CLOUD_KITCHEN', 'GAMING_CAFE', 'RACING'];

/* Delivery platforms as their own brands write them. */
export const PLATFORM_LABEL = { ZOMATO: 'Zomato', SWIGGY: 'Swiggy', ONDC: 'ONDC', MAGICPIN: 'Magicpin' };
export const platformName = (code) => PLATFORM_LABEL[code] || (code ? code.charAt(0) + code.slice(1).toLowerCase() : '');
