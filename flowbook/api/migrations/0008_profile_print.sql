-- Addresses, bank and UPI details, terms and print choices: what a printed invoice, a receipt and an e-way bill need.

ALTER TABLE organizations
  ADD COLUMN address_line TEXT, ADD COLUMN city TEXT, ADD COLUMN pincode TEXT, ADD COLUMN phone TEXT, ADD COLUMN email TEXT,
  ADD COLUMN bank_name TEXT, ADD COLUMN bank_account TEXT, ADD COLUMN bank_ifsc TEXT, ADD COLUMN upi_id TEXT, ADD COLUMN terms TEXT,
  ADD COLUMN print_settings JSONB NOT NULL DEFAULT '{}';
GRANT UPDATE (address_line, city, pincode, phone, email, bank_name, bank_account, bank_ifsc, upi_id, terms, print_settings) ON organizations TO flowbook_app;

ALTER TABLE parties
  ADD COLUMN address_line TEXT, ADD COLUMN city TEXT, ADD COLUMN pincode TEXT,
  ADD COLUMN ship_address_line TEXT, ADD COLUMN ship_city TEXT, ADD COLUMN ship_pincode TEXT;
