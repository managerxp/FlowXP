-- One sign-in: a FlowBook business can be the books of one FlowXP business, and people arrive through FlowXP's sign-in (src/sso.ts).
ALTER TABLE organizations ADD COLUMN flowxp_business_id TEXT;
CREATE UNIQUE INDEX organizations_flowxp_business ON organizations (flowxp_business_id) WHERE flowxp_business_id IS NOT NULL;
