-- A bill under reverse charge: the vendor charges no GST, the buyer owes it to the government and may claim it back as credit.
ALTER TABLE documents ADD COLUMN reverse_charge BOOLEAN NOT NULL DEFAULT false;
