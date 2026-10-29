-- The 40% slab for sin and luxury goods (in force from 22 September 2025): add it for every business that already exists.
INSERT INTO tax_rates (organization_id, code, name, rate_bp, effective_from)
SELECT id, 'GST40', 'GST 40%', 4000, DATE '2025-09-22' FROM organizations
ON CONFLICT DO NOTHING;
