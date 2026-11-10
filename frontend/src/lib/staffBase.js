/*
 * The staff screens (records, roster, attendance, leave, payroll) talk to /api/autoparts/staff and start on the real calendar day. staffApi and useStaffLoad are
 * drop-in replacements for api and useLoad on those pages: they take '/staff/...' paths, and '/dashboard' answers with today's date.
 */
import { api } from './api.js';
import { localISO } from './dates.js';
import { useLoad } from './salon.js';

const route = (path) => (path ? `/autoparts${path}` : path);

export const staffApi = (path, options) => api(route(path), options);

export const useStaffLoad = (path, options) => {
  const dashboard = path === '/dashboard';
  const r = useLoad(dashboard ? null : route(path), options);
  return dashboard ? { data: { business_date: localISO() }, loading: false, error: '', reload: () => {} } : r;
};
