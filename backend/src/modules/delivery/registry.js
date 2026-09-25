/*
 * The one place that knows which adapter a platform name maps to.
 *
 * integrations.controller.js and orders.controller.js both go through this
 * rather than importing an adapter module directly by name — adding a fifth
 * platform later is one entry here, not a grep-and-replace across every
 * caller.
 */
import * as zomato from './adapters/zomato.js';
import * as swiggy from './adapters/swiggy.js';
import * as ondc from './adapters/ondc.js';
import * as magicpin from './adapters/magicpin.js';

export const PLATFORMS = ['ZOMATO', 'SWIGGY', 'ONDC', 'MAGICPIN'];

const ADAPTERS = { ZOMATO: zomato, SWIGGY: swiggy, ONDC: ondc, MAGICPIN: magicpin };

/** Throws if `platform` isn't one of PLATFORMS — every caller wants that. */
export const getAdapter = (platform) => {
  const adapter = ADAPTERS[platform];
  if (!adapter) throw new Error(`Unknown delivery platform: ${platform}`);
  return adapter;
};
