-- Income Tax Act depreciation: each asset belongs to a block (a class with a fixed rate). The tax schedule is a report; nothing here posts to the books.
-- it_opening_wdv_minor: for an asset bought before these books began, its tax written-down value at the start of the financial year the books begin in.
-- it_use_date: the date it was first put to use, when different from the purchase date (under 180 days of use in the year earns half the rate).
ALTER TABLE fixed_assets ADD COLUMN it_block TEXT;
ALTER TABLE fixed_assets ADD COLUMN it_opening_wdv_minor BIGINT CHECK (it_opening_wdv_minor >= 0);
ALTER TABLE fixed_assets ADD COLUMN it_use_date DATE;
