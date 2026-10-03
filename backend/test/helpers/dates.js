/*
 * Test data is dated against the business's own calendar. A test business is in the schema's default timezone, and
 * between 00:00 and 05:30 IST that day is one ahead of UTC, so "n days from now" must not come from toISOString().
 */
export const TEST_TZ = 'Asia/Kolkata';
export const dayFromNow = (n = 0) => {
  const local = new Date().toLocaleDateString('en-CA', { timeZone: TEST_TZ });   // YYYY-MM-DD
  return new Date(Date.parse(`${local}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
};
