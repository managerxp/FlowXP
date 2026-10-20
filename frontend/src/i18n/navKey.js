/* The translation key for a sidebar label ("Warehouse & delivery" -> "warehouse_and_delivery"), so the menu data can stay readable English. */
export const navKey = (label) => String(label).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
