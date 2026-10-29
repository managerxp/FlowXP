-- Debit notes: a vendor's bill reduced (goods returned, price corrected). The credit is applied against the vendor's bills like a credit note against invoices.
ALTER TABLE documents DROP CONSTRAINT documents_kind_check;
ALTER TABLE documents ADD CONSTRAINT documents_kind_check CHECK (kind IN ('INVOICE', 'BILL', 'CREDIT_NOTE', 'QUOTE', 'SALES_ORDER', 'PURCHASE_ORDER', 'DEBIT_NOTE'));
DO $$ DECLARE k TEXT; BEGIN
  FOR k IN SELECT conname FROM pg_constraint WHERE conrelid = 'payment_allocations'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%CREDIT_NOTE%' LOOP
    EXECUTE format('ALTER TABLE payment_allocations DROP CONSTRAINT %I', k);
  END LOOP;
END $$;
ALTER TABLE payment_allocations ADD CONSTRAINT payment_allocations_source_type_check CHECK (source_type IN ('PAYMENT', 'CREDIT_NOTE', 'DEBIT_NOTE'));
