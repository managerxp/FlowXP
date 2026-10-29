-- GST charged when an asset is sold: kept on the asset so GSTR-3B can include the sale in outward supplies.
ALTER TABLE fixed_assets ADD COLUMN sale_gst_minor bigint NOT NULL DEFAULT 0 CHECK (sale_gst_minor >= 0);
ALTER TABLE fixed_assets ADD COLUMN sale_inter_state boolean NOT NULL DEFAULT false;
