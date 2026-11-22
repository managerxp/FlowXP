/*
 * The Popular and Offers shelves, decided by the server (what really sells here, what has an offer on right now) so the phone and the web
 * till always show the same. The last answer is kept on the phone, so the shelves still show with no signal.
 */
import { api } from './session.ts';
import { kvGet, kvSet } from './local.ts';

export type Shelves = { popular: number[]; offers: Map<number, string> };
export const noShelves = (): Shelves => ({ popular: [], offers: new Map() });

type Wire = { popular: number[]; offers: { product_id: number; label: string }[] };
const read = (w: Wire | null | undefined): Shelves => ({ popular: w?.popular ?? [], offers: new Map((w?.offers ?? []).map((o) => [o.product_id, o.label])) });

export const cachedShelves = async (key: string): Promise<Shelves> => {
  try { const raw = await kvGet(key); return raw ? read(JSON.parse(raw) as Wire) : noShelves(); } catch { return noShelves(); }
};

export const loadShelves = async (key: string): Promise<Shelves | null> => {
  try {
    const wire = await api.get<Wire>('/products/shelves');
    void kvSet(key, JSON.stringify(wire));
    return read(wire);
  } catch { return null; }   // offline: keep what is on screen
};
