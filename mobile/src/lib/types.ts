/* The shapes the pages read from the server (money in rupees as numbers, exactly as the API sends it). */
export type DashboardMetrics = { today: string; today_sales: number; today_invoice_count: number; yesterday_sales: number; outstanding: number; low_stock_count: number };
export type Dashboard = {
  metrics_available: boolean;
  metrics: DashboardMetrics | null;
  sales: {
    trend: { date: string; invoice_count: number; total: number }[];
    top_products: { product_id: number; name: string; quantity: number; revenue: number }[];
    recent_invoices: { invoice_id: number; invoice_number: string; customer_name: string | null; total: number; payment_status: string; created_at: string }[];
  } | null;
};
export type InvoiceRow = {
  invoice_id: number; invoice_number: string; invoice_date: string; customer_name: string | null; customer_phone: string | null;
  total: number; amount_paid: number; balance_due: number; payment_status: string; status: string; table_name: string | null; created_at: string;
};
export type InvoiceSummary = { bills: number; billed: number; paid: number; refunded: number; due: number; owing: number; paid_bills: number; cancelled: number; cancelled_value: number; average: number };
export type Customer = {
  customer_id: number; name: string; phone: string | null; email: string | null; address: string | null; gstin: string | null;
  credit_limit: number; outstanding_balance: number; total_purchases: number; bills: number; first_bill_date: string | null; last_bill_date: string | null; status: string;
};
export type StockRow = { product_id: number; name: string; unit: string | null; kind: string; current_stock: number; min_stock: number; low_stock: boolean; unit_cost: number; stock_value: number };
export type SalesReport = {
  range: { from: string; to: string }; total_sales: number; total_tax: number; invoice_count: number; outstanding: number;
  by_day: { date: string; invoice_count: number; total: number }[];
  top_products: { product_id: number; name: string; quantity: number; revenue: number }[];
  by_payment_method: { method: string; amount: number }[];
  by_hour: { hour: number; invoice_count: number; total: number }[];
  by_channel: { channel: string; platform: string | null; invoice_count: number; total: number }[];
  by_category: { category: string; quantity: number; revenue: number }[];
};
export type ProductFull = {
  product_id: number; name: string; sku: string | null; barcode: string | null; unit: string | null; category_name: string | null; selling_price: number; mrp: number | null;
  purchase_price: number; tax_rate: number; track_inventory: boolean; current_stock: number; min_stock: number; status: string; kind: string;
};
