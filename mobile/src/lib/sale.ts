/*
 * The sale in progress, kept outside any screen so it survives going to the scanner and back. `key` is the Idempotency-Key for THIS
 * sale: made when the cashier taps to take payment and kept until the server has accepted it, so a retry after a dropped connection
 * (the first attempt may have reached the server) returns the same invoice instead of billing twice. Any change to the cart makes a
 * new sale, so a new key.
 */
import { createStore, useStore } from './store.ts';
import { addProduct, emptyCart, setQuantity, type Cart } from './cart.ts';
import type { Picked } from './options.ts';
import type { Product } from './catalog.ts';
import { newKey } from './api.ts';
import { noOffers, type OffersResult } from './offers.ts';

export type SaleCustomer = { id: number; name: string; phone: string | null };
type Sale = { cart: Cart; key: string | null; kitchen: boolean; offers: OffersResult; customer: SaleCustomer | null };
export const saleStore = createStore<Sale>({ cart: emptyCart(), key: null, kitchen: true, offers: noOffers(), customer: null });
/** Put a customer on this bill (changes what is sent, so it is a new sale with a new key). */
export const setCustomer = (customer: SaleCustomer | null) => saleStore.set({ customer, key: null });
/** What the server says the offers save on the cart as it is now (asked by the till; cleared whenever the cart changes). */
export const setOffers = (offers: OffersResult) => saleStore.set({ offers });

export const add = (product: Product, by = 1, options?: Picked) => saleStore.set((s) => ({ cart: addProduct(s.cart, product, by, options), key: null, offers: noOffers() }));
export const setQty = (lineKey: string, quantity: number) => saleStore.set((s) => ({ cart: setQuantity(s.cart, lineKey, quantity), key: null, offers: noOffers() }));
/** A new sale. Whether it goes to the kitchen is the cashier's setting and stays. */
export const clearSale = () => saleStore.set({ cart: emptyCart(), key: null, offers: noOffers(), customer: null });
/** Send the sale to the kitchen or barista screen (changes what is sent, so it is a new sale with a new key). */
export const setKitchen = (kitchen: boolean) => saleStore.set({ kitchen, key: null });
/** The key for this sale, made once. */
export const keyForSale = (): string => {
  const existing = saleStore.get().key;
  if (existing) return existing;
  const key = newKey();
  saleStore.set({ key });
  return key;
};
export const useSale = () => useStore(saleStore);
