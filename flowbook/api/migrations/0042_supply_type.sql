-- How a sale is treated for GST: a normal sale, a supply to a Special Economic Zone unit (with or without paying IGST), or a deemed export.
-- Credit notes take the type of the invoice they are against. Purchases are not covered.
ALTER TABLE documents ADD COLUMN supply_type TEXT NOT NULL DEFAULT 'REGULAR' CHECK (supply_type IN ('REGULAR', 'SEZ_WITH_PAY', 'SEZ_WITHOUT_PAY', 'DEEMED_EXPORT'));
