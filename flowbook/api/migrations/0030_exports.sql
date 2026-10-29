-- Export invoices (a foreign-currency invoice) are listed in their own GSTR-1 table with the shipping bill details.
ALTER TABLE documents ADD COLUMN shipping_bill_no TEXT;
ALTER TABLE documents ADD COLUMN shipping_bill_date DATE;
ALTER TABLE documents ADD COLUMN port_code TEXT;
