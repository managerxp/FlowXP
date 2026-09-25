/*
 * The super admin API client — a small parallel to lib/api.js, not a
 * refactor of it.
 *
 * Kept separate deliberately: a super admin session and a business-owner
 * session are different tokens that must be able to coexist in the same
 * browser (testing the admin console and the product side by side is
 * exactly what this exists for), so this uses its own localStorage key
 * rather than sharing lib/api.js's `flowxp.token`. It also never sends
 * X-Business-Id — every /api/admin/* route is platform-wide, not scoped to
 * one tenant.
 */

const ADMIN_TOKEN_KEY = 'flowxp.admin.token';

export const getAdminToken = () => localStorage.getItem(ADMIN_TOKEN_KEY);
export const setAdminToken = (token) => localStorage.setItem(ADMIN_TOKEN_KEY, token);
export const clearAdminToken = () => localStorage.removeItem(ADMIN_TOKEN_KEY);

export class AdminApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
  }
}

export const adminApi = async (path, { method = 'GET', body } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  const token = getAdminToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`/api/admin${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) clearAdminToken();
    throw new AdminApiError(payload.message || 'Something went wrong', response.status);
  }

  return payload.data ?? payload;
};
