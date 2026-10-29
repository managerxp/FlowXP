-- Purchase orders: sent to a vendor, post nothing, and turn into the vendor's bill.
ALTER TABLE documents DROP CONSTRAINT documents_kind_check;
ALTER TABLE documents ADD CONSTRAINT documents_kind_check CHECK (kind IN ('INVOICE', 'BILL', 'CREDIT_NOTE', 'QUOTE', 'SALES_ORDER', 'PURCHASE_ORDER'));
