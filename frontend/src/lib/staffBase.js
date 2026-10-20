/*
 * The staff screens (records, roster, attendance, leave, payroll) were built for a hotel and serve a spare parts workshop too: the same pages, talking to
 * /api/autoparts/staff instead of /api/hotel/staff, and starting on the real calendar day (a hotel's own date moves with its night audit). A page calls
 * setStaffMode(business type) once when it opens; staffApi and useStaffLoad are then drop-in replacements for api and useLoad on those pages.
 */
import { api } from './api.js';
import { localISO } from './dates.js';
import { useLoad } from './salon.js';

let parts = false;
export const setStaffMode = (businessType) => { parts = businessType === 'AUTO_PARTS'; };
const route = (path) => (parts && path ? path.replace('/hotel/staff', '/autoparts/staff') : path);

export const staffApi = (path, options) => api(route(path), options);

export const useStaffLoad = (path, options) => {
  const dashboard = parts && path === '/hotel/dashboard';
  const r = useLoad(dashboard ? null : route(path), options);
  return dashboard ? { data: { business_date: localISO() }, loading: false, error: '', reload: () => {} } : r;
};
