/*
 * Clothing on the phone: the shapes the server sends for styles, sizes, colours and insights, and the few pure helpers the screens share. A size and colour is a
 * product of its own on the server, so the till adds it like any other product: this turns one grid cell into that product.
 */
import type { Product } from './catalog.ts';

export type StyleRow = {
  style_id: number; style_code: string; name: string; status: string; stock: number; variants: number; sold_out: number;
  product_ids: number[]; price_from_paise: number | null; price_to_paise: number | null; colours: unknown[]; category_name: string | null; brand_name: string | null; gender: string | null;
};
export type Cell = { product_id: number; stock: number; sku: string | null; barcode: string | null; selling_price_paise: number; low: boolean };
export type StyleDetail = {
  style_id: number; style_code: string; name: string; tax_rate: number | string; stock: number; hsn_sac: string | null; mrp_paise: number | null; selling_price_paise: number | null;
  matrix: { colours: { name: string; hex: string | null }[]; sizes: string[]; grid: Record<string, Record<string, Cell>> };
};

/** One grid cell as a till product: the style's name with the colour and size, that variant's own price, and the style's GST. */
export const variantProduct = (style: Pick<StyleDetail, 'name' | 'tax_rate'>, colour: string, size: string, cell: Cell): Product => ({
  product_id: cell.product_id, name: `${style.name} · ${colour} · ${size}`, sku: cell.sku, barcodes: cell.barcode ? [cell.barcode] : [], unit: 'pc',
  selling_price: cell.selling_price_paise / 100, mrp: null, tax_rate: Number(style.tax_rate), track_inventory: true, current_stock: cell.stock,
  category_name: null, is_available: true, modifier_group_ids: []
});

/** "₹599" or "₹599+" when the sizes are priced differently. */
export const priceText = (from: number | null, to: number | null, rupees: (paise: number) => string): string => (from == null ? '' : from === to || to == null ? rupees(from) : `${rupees(from)}+`);

export type Share = { pieces: number; share_pct: number; stock: number; sell_through_pct: number };
export type Analytics = {
  days: number; dead_days: number; bills: number;
  totals: { pieces: number; revenue_paise: number; margin_paise: number; margin_pct: number | null; stock: number; stock_value_paise: number };
  sizes: (Share & { size: string })[]; colours: (Share & { colour: string; hex: string | null })[];
  styles: (Share & { style_id: number; style_code: string; name: string; revenue_paise: number; margin_paise: number; margin_pct: number | null })[];
  ageing: { label: string; pieces: number; value_paise: number }[];
  dead: { product_id: number; style_name: string; colour: string; size: string; stock: number; value_paise: number; days: number; never_sold: boolean }[];
  dead_total: { variants: number; pieces: number; value_paise: number };
};
