/*
 * The only place that talks to the API.
 *
 * Plain fetch. Axios buys interceptors and a slightly nicer error object; this
 * file is forty lines and already has both, so it would be a dependency paying
 * for itself in convenience we already have.
 */

const TOKEN_KEY = 'flowxp.token';
const BUSINESS_KEY = 'flowxp.business';
const BRANCH_KEY = 'flowxp.branch';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(BUSINESS_KEY);
  localStorage.removeItem(BRANCH_KEY);
};

export const getBusinessId = () => localStorage.getItem(BUSINESS_KEY) || null;
export const setBusinessId = (id) =>
  id == null ? localStorage.removeItem(BUSINESS_KEY) : localStorage.setItem(BUSINESS_KEY, String(id));

/* The outlet being viewed: an outlet id, or 'all' for a group user reading across outlets.
   Sent as a claim (X-Branch-Id); the server verifies it and forces it for people pinned to one outlet. */
export const getBranchId = () => localStorage.getItem(BRANCH_KEY) || null;
export const setBranchId = (id) =>
  id == null ? localStorage.removeItem(BRANCH_KEY) : localStorage.setItem(BRANCH_KEY, String(id));

/** Thrown for every non-2xx response, carrying the parts a caller acts on. */
export class ApiError extends Error {
  constructor(message, status, code, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;     // TRIAL_ENDED, NO_BUSINESS, BUSINESS_REQUIRED
    this.data = data;
  }
}

export const api = async (path, { method = 'GET', body, businessId, idempotencyKey } = {}) => {
  // A file upload (product photos) passes a FormData body — it must never be
  // JSON.stringify'd, and the Content-Type header must be left for the
  // browser to set itself (multipart/form-data with the boundary it chose),
  // not fixed to application/json.
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers = isFormData ? {} : { 'Content-Type': 'application/json' };

  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  /* Which business this request is about. Sent as a header rather than woven
     into every URL, so switching businesses does not mean rewriting routes —
     and the server treats it as a claim to verify either way. */
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const scope = businessId ?? getBusinessId();
  if (scope) headers['X-Business-Id'] = String(scope);
  const outlet = getBranchId();
  if (outlet) headers['X-Branch-Id'] = outlet;

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body)
  });

  /* A 502 from a proxy is HTML, not JSON. Parsing defensively means a failed
     deploy shows "Something went wrong" instead of a JSON syntax error. */
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    /* An expired or forged token means the session is over. Clearing it here,
       once, saves every caller from checking — and leaving a dead token in
       localStorage puts the app in a loop of 401s. 402 is the trial ending,
       which is not a session problem. */
    if (response.status === 401) clearToken();
    throw new ApiError(
      payload.message || 'Something went wrong',
      response.status,
      payload.code,
      payload.data
    );
  }

  return payload.data ?? payload;
};

/** Download a file the API produces (a CSV export) under the person's own session. */
export const downloadFile = async (path, filename) => {
  const headers = {};
  const token = getToken(); if (token) headers.Authorization = `Bearer ${token}`;
  const scope = getBusinessId(); if (scope) headers['X-Business-Id'] = String(scope);
  const outlet = getBranchId(); if (outlet) headers['X-Branch-Id'] = outlet;
  const response = await fetch(`/api${path}`, { headers });
  if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new ApiError(payload.message || 'Could not download that', response.status); }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  URL.revokeObjectURL(url);
};

/* Plans still quote prices in paise (see backend/src/config/database.js) —
   this divides by 100. */
export const formatMoney = (paise, currency = 'INR') =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0
  }).format((paise || 0) / 100);

/* Every commerce endpoint (products, invoices, reports...) converts paise to
   rupees server-side before it reaches JSON — see backend/src/utils/money.js.
   This formats that decimal directly; it must never divide by 100 again. */
export const formatCurrency = (amount, currency = 'INR') =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2
  }).format(amount || 0);
