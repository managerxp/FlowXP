-- Quotes and sales orders are documents that post nothing: they are numbered when sent, can be accepted or declined, and turn into the next document.

DO $$ DECLARE k TEXT; BEGIN
  FOR k IN SELECT conname FROM pg_constraint WHERE conrelid = 'documents'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%CREDIT_NOTE%' LOOP
    EXECUTE format('ALTER TABLE documents DROP CONSTRAINT %I', k);
  END LOOP;
END $$;
ALTER TABLE documents ADD CONSTRAINT documents_kind_check CHECK (kind IN ('INVOICE', 'BILL', 'CREDIT_NOTE', 'QUOTE', 'SALES_ORDER'));
ALTER TABLE documents
  ADD COLUMN outcome TEXT CHECK (outcome IN ('ACCEPTED', 'DECLINED', 'CONVERTED')),
  ADD COLUMN converted_document_id BIGINT;
