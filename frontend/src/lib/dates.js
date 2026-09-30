/*
 * Calendar dates as the person looking at the screen sees them. toISOString()
 * converts to UTC first, so between midnight and 5:30 a.m. in India it names
 * yesterday — which quietly drops the latest day from any date-range request.
 */
export const localISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const daysAgoISO = (n) => localISO(new Date(Date.now() - n * 86400000));
