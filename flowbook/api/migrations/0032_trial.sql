-- 7-day free trial. A new business starts on TRIAL for seven days; when the trial ends it can still be read and exported but nothing new can be written
-- until it is switched to ACTIVE (done by the owner of the product for now: UPDATE organizations SET plan = 'ACTIVE'). Businesses that already existed are ACTIVE.
ALTER TABLE organizations ADD COLUMN plan TEXT NOT NULL DEFAULT 'TRIAL' CHECK (plan IN ('TRIAL', 'ACTIVE'));
ALTER TABLE organizations ADD COLUMN trial_ends_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days';
UPDATE organizations SET plan = 'ACTIVE';
