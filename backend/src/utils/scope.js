/*
 * Outlet scoping for reads. `tenant.scopeBranchId` is the outlet the request is
 * limited to (null = every outlet the user may see). Append the returned clause
 * to a WHERE that already has `business_id = $n`; it adds its own parameter.
 *
 *   const params = [businessId];
 *   const sql = `SELECT ... WHERE i.business_id = $1${branchFilter(tenant, 'i.branch_id', params)}`;
 */
export const branchFilter = (tenant, column, params) => {
  const id = tenant?.scopeBranchId;
  if (id == null) return '';
  params.push(id);
  return ` AND ${column} = $${params.length}`;
};
