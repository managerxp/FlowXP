/* The spare parts counter and storeroom on a phone: find a part by any number, see where it sits, find parts for a vehicle, put received stock on a shelf, move it between bins,
   and receive a delivery. The server decides (stock, fitment, prices); these only shape what a screen shows and sends. Online only: bins and receipts are shared by the whole shop. */

export const AUTO_PARTS_TYPES = ['AUTO_PARTS'];

export type PartRow = {
  product_id: number; name: string; sku: string | null; barcode?: string | null; selling_price_paise: number; mrp_paise: number | null; purchase_price_paise?: number; stock?: number;
  oem_part_no: string | null; mfr_part_no: string | null; classification: string | null; brand_name: string | null; category_name?: string | null; matched_on?: string;
};
export type PartNumber = { pn_id: number; number: string; kind: string };
export type FitRow = { fit_id: number; make: string; model: string; variant: string | null; year_from: number | null; year_to: number | null; status: 'VERIFIED' | 'UNVERIFIED' | 'NOT_FIT' };
export type Branch = { branch_id: number; name: string; quantity: number; reserved: number; available: number };
export type PartDetail = PartRow & { numbers: PartNumber[]; fitment: FitRow[]; branches: Branch[]; barcodes: string[]; has_profile: boolean };
export type Bin = { location_id: number; code: string; qty: number; reserved_qty: number; available: number; is_primary: boolean };
export type PartLocations = { on_hand: number; binned: number; unassigned: number; bins: Bin[] };
export type Place = { location_id: number; code: string; name: string | null; can_store: boolean; is_active: boolean; path: { code: string }[]; capacity_units: number | null; parts: { product_id: number; name: string; sku: string | null; qty: number; reserved_qty: number; location_code: string; is_primary: boolean }[] };
export type Waiting = { product_id: number; name: string; sku: string | null; on_hand: number; binned: number; unassigned: number };
export type StorePlace = { location_id: number; code: string; can_store: boolean; is_active: boolean; capacity_units: number | null; qty: number };
export type VehicleModel = { model_id: number; name: string };
export type VehicleMake = { make_id: number; name: string; vehicle_type: string; models: VehicleModel[] };
export type VehiclePart = { product_id: number; name: string; sku: string | null; selling_price_paise: number; stock: number; oem_part_no: string | null; brand_name: string | null; fitment: 'VERIFIED' | 'UNVERIFIED'; warning: string | null };

/* Fitment is never assumed: a part either has a record for the vehicle, or "no fitment on record". */
export const FIT_LABEL: Record<string, string> = { VERIFIED: 'Fits (verified)', UNVERIFIED: 'Fitment not verified', NOT_FIT: 'Does not fit', UNKNOWN: 'No fitment on record' };
export const FIT_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'soft'> = { VERIFIED: 'ok', UNVERIFIED: 'warn', NOT_FIT: 'bad', UNKNOWN: 'soft' };
export const CLASS_LABEL: Record<string, string> = { OEM: 'OEM (genuine)', AFTERMARKET: 'Aftermarket', REFURBISHED: 'Refurbished', USED: 'Used' };

export const yearsText = (f: Pick<FitRow, 'year_from' | 'year_to'>): string => (f.year_from || f.year_to ? `${f.year_from ?? '...'} to ${f.year_to ?? '...'}` : 'any year');
export const vehicleText = (f: Pick<FitRow, 'make' | 'model' | 'variant'>): string => `${f.make} ${f.model}${f.variant ? ` ${f.variant}` : ''}`;

/** "OEM 5551168K00 · SKU AP-0004": the numbers a counter person reads out. */
export const partSub = (p: Pick<PartRow, 'sku' | 'oem_part_no' | 'mfr_part_no' | 'brand_name'>): string =>
  [p.oem_part_no ? `OEM ${p.oem_part_no}` : null, p.mfr_part_no ? `Mfr ${p.mfr_part_no}` : null, p.sku, p.brand_name].filter(Boolean).join(' · ');
export const stockText = (n: number | undefined): string => (n === undefined ? '' : n <= 0 ? 'Out of stock' : `${Math.round(n * 1000) / 1000} in stock`);

/** What a scan gives: a printed bin label is "FXB:token", a part barcode or part number is used as typed. */
export const isBinLabel = (code: string): boolean => /^FXB:/i.test(code.trim());
export const lookupPath = (q: string, limit = 15): string | null => (q.trim().length >= 2 ? `/autoparts/parts/lookup?q=${encodeURIComponent(q.trim())}&limit=${limit}` : null);
export const placePath = (code: string): string => `/autoparts/locations/scan?code=${encodeURIComponent(code.trim())}`;
export const vehiclePartsPath = (modelId: number, year: string, search: string): string =>
  `/autoparts/vehicles/parts?model_id=${modelId}${/^\d{4}$/.test(year.trim()) ? `&year=${year.trim()}` : ''}${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}&limit=100`;

/** The bins stock can be put in: switched on, and holding stock rather than only grouping. */
export const storingBins = (places: StorePlace[]): StorePlace[] => places.filter((l) => l.can_store && l.is_active);
/** A bin by the code someone types or scans (any case, spaces ignored). */
export const binByCode = (places: StorePlace[], code: string): StorePlace | null => {
  const want = code.trim().toLowerCase().replace(/\s+/g, '');
  return want ? storingBins(places).find((l) => l.code.toLowerCase() === want) ?? null : null;
};

/* ── put away and move ─────────────────────────────────────────────────── */

export const putAwayProblem = (qty: string, waiting: number, locationId: number | null): string => {
  if (!locationId) return 'Choose the bin first.';
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) return 'Type how many.';
  if (n > waiting + 1e-9) return `Only ${waiting} are waiting for a bin.`;
  return '';
};
export const putAwayBody = (productId: number, locationId: number, qty: string, key: string) => ({ product_id: productId, location_id: locationId, qty: Number(qty), source_key: key });

export const moveProblem = (fromId: number | null, toId: number | null, qty: string, free: number): string => {
  if (!fromId) return 'Choose the bin it is in.';
  if (!toId) return 'Choose the bin it goes to.';
  if (fromId === toId) return 'Choose a different bin to move to.';
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) return 'Type how many.';
  if (n > free + 1e-9) return `Only ${free} can be moved from that bin.`;
  return '';
};
export const moveBody = (productId: number, fromId: number, toId: number, qty: string, key: string) => ({ product_id: productId, from_location_id: fromId, to_location_id: toId, qty: Number(qty), source_key: key });

/** Where to pick a part from first: its pick bin, then the fullest. */
export const pickOrder = (bins: Bin[]): Bin[] => [...bins].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || b.available - a.available);

/* ── receiving ─────────────────────────────────────────────────────────── */

export type RecvLine = { product_id: number; name: string; sku: string | null; received: string; damaged: string; rejected: string; cost: string; binId: number | null; binCode: string | null };
const n = (s: string): number => (s.trim() === '' ? 0 : Number(s));
/** What is left to sell: arrived less damaged and rejected. Only this becomes stock. */
export const acceptedOf = (l: Pick<RecvLine, 'received' | 'damaged' | 'rejected'>): number => Math.max(0, Math.round((n(l.received) - n(l.damaged) - n(l.rejected)) * 1000) / 1000);
export const recvLineProblem = (l: RecvLine): string => {
  if (![l.received, l.damaged, l.rejected, l.cost].every((x) => x.trim() === '' || Number.isFinite(Number(x)))) return `${l.name}: type numbers only.`;
  if (n(l.received) <= 0) return '';
  if (n(l.damaged) < 0 || n(l.rejected) < 0 || n(l.cost) < 0) return `${l.name}: numbers cannot be negative.`;
  if (n(l.damaged) + n(l.rejected) > n(l.received) + 1e-9) return `${l.name}: damaged and rejected cannot be more than what arrived.`;
  return '';
};
export const recvProblem = (supplierId: number | null, lines: RecvLine[]): string => {
  if (!supplierId) return 'Choose the supplier.';
  for (const l of lines) { const p = recvLineProblem(l); if (p) return p; }
  if (!lines.some((l) => n(l.received) > 0)) return 'Type how many arrived on at least one part.';
  return '';
};
export const recvBody = (supplierId: number, invoice: string, lines: RecvLine[]) => ({
  supplier_id: supplierId, ...(invoice.trim() ? { supplier_invoice_no: invoice.trim() } : {}),
  items: lines.filter((l) => n(l.received) > 0).map((l) => ({ product_id: l.product_id, received: n(l.received), damaged: n(l.damaged), rejected: n(l.rejected), unit_cost: n(l.cost), ...(l.binId ? { bin_id: l.binId } : {}) }))
});
export const addRecvLine = (lines: RecvLine[], p: Pick<PartRow, 'product_id' | 'name' | 'sku' | 'purchase_price_paise'>): RecvLine[] =>
  lines.some((l) => l.product_id === p.product_id) ? lines : [...lines, { product_id: p.product_id, name: p.name, sku: p.sku, received: '', damaged: '', rejected: '', cost: p.purchase_price_paise ? String(p.purchase_price_paise / 100) : '', binId: null, binCode: null }];
export const recvSummary = (lines: RecvLine[]): { arrived: number; accepted: number; damaged: number; rejected: number } =>
  lines.reduce((s, l) => ({ arrived: s.arrived + n(l.received), accepted: s.accepted + acceptedOf(l), damaged: s.damaged + n(l.damaged), rejected: s.rejected + n(l.rejected) }), { arrived: 0, accepted: 0, damaged: 0, rejected: 0 });
