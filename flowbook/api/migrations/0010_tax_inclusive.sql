-- A line's price can be entered with GST already in it (a shop's shelf price); the line then keeps what was typed.
ALTER TABLE document_lines ADD COLUMN price_includes_tax BOOLEAN NOT NULL DEFAULT false;
