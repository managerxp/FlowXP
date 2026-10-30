-- a site supervisor: records stock and sees the projects, but not the money
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ('owner', 'admin', 'accountant', 'sales', 'purchases', 'viewer', 'auditor', 'site'));
