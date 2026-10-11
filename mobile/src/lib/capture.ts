/* Scanning a barcode FOR a form (a new product's barcode) instead of for the bill: the scanner leaves the code here and the form picks it up. */
import { createStore, useStore } from './store.ts';

export const captureStore = createStore<{ code: string | null }>({ code: null });
export const useCaptured = () => useStore(captureStore).code;
export const setCaptured = (code: string | null) => captureStore.set({ code });
