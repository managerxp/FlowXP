-- Input credit that section 17(5) of the GST Act does not allow, on a purchase bill: the reason, or NULL when the credit is allowed.
-- A debit note takes the reason of the bill it corrects.
ALTER TABLE documents ADD COLUMN itc_blocked TEXT CHECK (itc_blocked IN ('CONSTRUCTION', 'VEHICLE', 'FOOD_TRAVEL', 'PERSONAL', 'GIFTS_LOST', 'OTHER'));
